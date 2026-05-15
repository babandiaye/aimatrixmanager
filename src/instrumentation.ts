/**
 * Next.js instrumentation hook — démarré une seule fois au boot du serveur
 * (production : `pnpm start` ; dev : démarrage du dev server, pas à chaque HMR).
 *
 * On y démarre le worker BullMQ qui traite les jobs d'indexation RAG en
 * arrière-plan. Sans ça, la queue se rempli mais rien ne consomme.
 *
 * Garde Edge : on charge uniquement en runtime Node — le worker BullMQ utilise
 * `ioredis` qui ne tourne pas en Edge.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startRagWorker } = await import("./lib/queue/rag-worker");
  startRagWorker();
}
