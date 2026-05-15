/**
 * Génération d'embeddings via Ollama OpenAI-compat (fromager.unchk.sn).
 * Modèle : nomic-embed-text:latest (768-dim, normalisé pour cosine).
 *
 * Pourquoi `nomic-embed-text` :
 *  - Souverain (UN-CHK), pas de fuite vers US
 *  - 768-dim → léger, index HNSW perf
 *  - Format compatible OpenAI Embeddings API
 */
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "embeddings" });

const EMBED_MODEL = "nomic-embed-text:latest";
const EMBED_DIM = 768;

function endpoint(): string {
  const base = process.env.OLLAMA_BASE_URL;
  const key = process.env.OLLAMA_API_KEY;
  if (!base || !key) {
    throw new Error("OLLAMA_BASE_URL ou OLLAMA_API_KEY absent du .env");
  }
  return base.replace(/\/$/, "");
}

/**
 * Embed un seul texte. Pour un batch, préférer `embedBatch` qui parallélise.
 */
export async function embedOne(text: string): Promise<number[]> {
  const apiKey = process.env.OLLAMA_API_KEY!;
  const res = await fetch(`${endpoint()}/v1/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) {
    throw new Error(
      `Embeddings HTTP ${res.status} : ${(await res.text()).substring(0, 200)}`,
    );
  }
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const v = data.data?.[0]?.embedding;
  if (!v || v.length !== EMBED_DIM) {
    throw new Error(`Embedding invalide (length=${v?.length})`);
  }
  return v;
}

/**
 * Embed N textes séquentiellement avec retry exponentiel.
 * fromager.unchk.sn est mono-GPU et ne supporte pas la concurrence (renvoie
 * 503 immédiatement quand 2 requêtes arrivent en parallèle). On reste donc
 * en serial (concurrency=1) — chaque embedding est rapide (~50-200ms) donc
 * 100 chunks = ~10-20s, acceptable.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = new Array(texts.length);
  for (let i = 0; i < texts.length; i++) {
    let attempt = 0;
    while (true) {
      try {
        results[i] = await embedOne(texts[i]);
        break;
      } catch (e) {
        attempt++;
        if (attempt >= 4) throw e;
        // Backoff exponentiel : 200ms, 500ms, 1s, 2s + jitter
        const delay = Math.pow(2, attempt) * 100 + Math.random() * 100;
        log.warn(
          { i, attempt, delay: Math.round(delay), err: e instanceof Error ? e.message.substring(0, 80) : e },
          "Retry embed après backoff",
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  return results;
}

/**
 * Formate un vecteur pour Postgres pgvector (input syntax).
 * Postgres attend `'[0.1,0.2,...]'::vector`.
 */
export function vectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
