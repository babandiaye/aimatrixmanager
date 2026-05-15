/**
 * Worker BullMQ qui exécute le pipeline RAG d'un cours.
 *
 * Démarré une seule fois au boot Next.js via `src/instrumentation.ts`.
 * Singleton protégé par globalThis pour résister au HMR en dev.
 *
 * Étapes du pipeline (avec progress reporting) :
 *   0-10%   : sync structurel Moodle (sections + resources)
 *  10-50%   : extraction texte + chunking (download PDFs, etc.)
 *  50-95%   : embeddings via fromager (Ollama)
 *  95-100%  : flag reindexEnabled + revalidate paths
 */
import { Worker } from "bullmq";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { extractCourseContents, embedCourseChunks } from "@/lib/rag-indexer";
import { syncCourseContentsCore } from "@/lib/moodle-course-sync";
import {
  RAG_QUEUE_NAME,
  ragConnection,
  type RagJobData,
  type RagJobResult,
} from "./rag";

const log = logger.child({ mod: "queue.rag-worker" });

const globalForWorker = globalThis as unknown as {
  ragWorker: Worker<RagJobData, RagJobResult> | undefined;
};

export function startRagWorker(): Worker<RagJobData, RagJobResult> {
  if (globalForWorker.ragWorker) return globalForWorker.ragWorker;

  const worker = new Worker<RagJobData, RagJobResult>(
    RAG_QUEUE_NAME,
    async (job) => {
      const { courseDbId, triggeredBy } = job.data;
      log.info({ jobId: job.id, courseDbId, triggeredBy }, "RAG job start");

      // Étape 1 — Sync structurel (rapide, ~1s)
      await job.updateProgress(5);
      const sync = await syncCourseContentsCore(courseDbId);
      await job.updateProgress(10);

      // Étape 2 — Extraction + chunking (download PDFs, peut prendre 1-30s
      // selon le cours)
      const extract = await extractCourseContents(courseDbId);
      await job.updateProgress(50);

      // Étape 3 — Embeddings (le plus long : 2-3s par batch de 32 chunks
      // sur fromager mono-GPU)
      const embed = await embedCourseChunks(courseDbId);
      await job.updateProgress(95);

      // Étape 4 — Active opt-in
      await prisma.moodleCourse.update({
        where: { id: courseDbId },
        data: { reindexEnabled: true, lastIndexedAt: new Date() },
      });
      await job.updateProgress(100);

      log.info(
        { jobId: job.id, courseDbId, sync, extract, embed },
        "RAG job done",
      );
      return { sync, extract, embed };
    },
    {
      connection: ragConnection,
      // 1 job à la fois — embeddings serial sur fromager mono-GPU, et
      // chaque job peut consommer beaucoup de RAM (chunks, PDF en mémoire).
      concurrency: 1,
      // Lock prolongé : 5 min max par job. Au-delà, BullMQ considère le
      // worker stuck et un autre peut reprendre. En in-process single
      // worker ça ne sert qu'à se protéger d'un kill/redeploy.
      lockDuration: 5 * 60 * 1000,
    },
  );

  worker.on("ready", () => log.info("RAG worker ready"));
  worker.on("active", (job) =>
    log.info({ jobId: job.id, courseDbId: job.data.courseDbId }, "job active"),
  );
  worker.on("completed", (job) =>
    log.info({ jobId: job.id, courseDbId: job.data.courseDbId }, "job done"),
  );
  worker.on("failed", (job, err) =>
    log.warn(
      { jobId: job?.id, courseDbId: job?.data.courseDbId, err: err.message },
      "job failed",
    ),
  );
  worker.on("error", (err) => log.error({ err: err.message }, "worker error"));

  globalForWorker.ragWorker = worker;
  return worker;
}
