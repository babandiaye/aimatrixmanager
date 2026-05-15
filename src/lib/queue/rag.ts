/**
 * Queue BullMQ pour l'indexation RAG d'un cours Moodle.
 *
 * Pourquoi une queue : le pipeline `fullReindexCourse` peut prendre plusieurs
 * minutes (download PDF + extraction + embeddings serial). Le faire en
 * synchrone bloque la requête → timeout proxy (nginx 60s par défaut) et UX
 * mauvaise (spinner indéfini).
 *
 * Architecture :
 *  - 1 queue `rag` (Redis-backed via BullMQ)
 *  - jobId = courseDbId → idempotence : re-cliquer pendant un job en cours
 *    réutilise le même job au lieu de doubler le travail
 *  - 1 worker en process (lancé via `instrumentation.ts` au boot Next.js)
 *  - le worker met à jour `job.progress` (0-100) à chaque étape
 *  - l'UI poll `getRagJobStatus(courseId)` toutes les 2s
 */
import { Queue, type ConnectionOptions } from "bullmq";
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "queue.rag" });

// BullMQ exige une connection séparée pour les blocking commands.
// On parse REDIS_URL pour en faire un ConnectionOptions BullMQ.
function parseRedisUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 6379,
    password: u.password || undefined,
    db: u.pathname && u.pathname !== "/" ? parseInt(u.pathname.slice(1), 10) : 0,
    // Requis par BullMQ pour les blocking calls — sinon erreurs au boot
    maxRetriesPerRequest: null,
  };
}

export const ragConnection: ConnectionOptions = parseRedisUrl(
  process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
);

export const RAG_QUEUE_NAME = "rag-index";

export type RagJobData = {
  courseDbId: string;
  triggeredBy: string; // userId
};

export type RagJobResult = {
  sync: {
    sections: number;
    resources: number;
    resourcesByType?: Record<string, number>;
    removedSections?: number;
    removedResources?: number;
  };
  extract: {
    sections: { processed: number; chunks: number };
    resources: {
      processed: number;
      skipped: number;
      failed: number;
      chunks: number;
    };
    errors?: Array<{ entity: string; name: string; error: string }>;
  };
  embed: { embedded: number; alreadyEmbedded: number; failed: number };
};

// Singleton — important en dev (HMR) pour ne pas créer N queues
const globalForQueue = globalThis as unknown as {
  ragQueue: Queue<RagJobData, RagJobResult> | undefined;
};

export const ragQueue: Queue<RagJobData, RagJobResult> =
  globalForQueue.ragQueue ??
  new Queue<RagJobData, RagJobResult>(RAG_QUEUE_NAME, {
    connection: ragConnection,
    defaultJobOptions: {
      // On garde 50 jobs terminés / 100 jobs ratés pour debug + UI history.
      // Au-delà, BullMQ purge automatiquement.
      removeOnComplete: { count: 50, age: 24 * 3600 },
      removeOnFail: { count: 100, age: 7 * 24 * 3600 },
      attempts: 2,
      backoff: { type: "exponential", delay: 30_000 },
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForQueue.ragQueue = ragQueue;
}

/**
 * Ajoute un job d'indexation pour un cours. jobId = courseDbId → si un job
 * du même cours est déjà queued/active, BullMQ retourne le job existant
 * (pas de double enqueue).
 */
export async function enqueueRagIndex(
  data: RagJobData,
): Promise<{ jobId: string; alreadyQueued: boolean }> {
  const existing = await ragQueue.getJob(data.courseDbId);
  if (existing) {
    const state = await existing.getState();
    if (state === "active" || state === "waiting" || state === "delayed") {
      log.info(
        { courseDbId: data.courseDbId, jobId: existing.id, state },
        "RAG job déjà en cours — réutilisation",
      );
      return { jobId: existing.id!, alreadyQueued: true };
    }
    // Si completed/failed : on supprime pour pouvoir relancer
    await existing.remove();
  }

  const job = await ragQueue.add(RAG_QUEUE_NAME, data, {
    jobId: data.courseDbId,
  });
  log.info(
    { courseDbId: data.courseDbId, jobId: job.id, triggeredBy: data.triggeredBy },
    "RAG job enqueued",
  );
  return { jobId: job.id!, alreadyQueued: false };
}

export type RagJobStatus = {
  state: "waiting" | "active" | "completed" | "failed" | "delayed" | "none";
  progress: number; // 0-100
  result?: RagJobResult;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
};

/**
 * Lit l'état d'un job (pour l'UI polling). `state = "none"` si aucun job
 * connu pour ce cours.
 */
export async function getRagJobStatusByCourse(
  courseDbId: string,
): Promise<RagJobStatus> {
  const job = await ragQueue.getJob(courseDbId);
  if (!job) return { state: "none", progress: 0 };

  const state = (await job.getState()) as RagJobStatus["state"];
  const progress =
    typeof job.progress === "number"
      ? job.progress
      : typeof job.progress === "object"
        ? ((job.progress as { percent?: number }).percent ?? 0)
        : 0;

  return {
    state,
    progress,
    result: job.returnvalue,
    error: job.failedReason,
    startedAt: job.processedOn,
    finishedAt: job.finishedOn,
  };
}
