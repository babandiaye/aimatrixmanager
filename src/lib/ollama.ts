/**
 * Helpers pour interroger le serveur Ollama (UN-CHK / fromager).
 * On lit l'URL et la clé depuis .env, jamais directement côté client.
 */
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "ollama" });

export type OllamaModel = {
  name: string;
  size: number;
  parameter_size?: string;
  family?: string;
};

function getEnv() {
  const baseUrl = process.env.OLLAMA_BASE_URL;
  const apiKey = process.env.OLLAMA_API_KEY;
  if (!baseUrl || !apiKey) {
    return null;
  }
  return { baseUrl, apiKey };
}

export function isOllamaConfigured(): boolean {
  return getEnv() !== null;
}

/**
 * Récupère la liste des modèles dispo sur le serveur Ollama.
 * Mise en cache courte (60s) côté Next pour éviter de spammer fromager.
 */
export async function listOllamaModels(): Promise<OllamaModel[]> {
  const env = getEnv();
  if (!env) return [];

  try {
    const res = await fetch(`${env.baseUrl}/api/tags`, {
      headers: { Authorization: `Bearer ${env.apiKey}` },
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      log.warn({ status: res.status }, "Ollama /api/tags error");
      return [];
    }
    const data = (await res.json()) as {
      models: Array<{
        name: string;
        size: number;
        details?: { parameter_size?: string; family?: string };
      }>;
    };
    return data.models.map((m) => ({
      name: m.name,
      size: m.size,
      parameter_size: m.details?.parameter_size,
      family: m.details?.family,
    }));
  } catch (e) {
    log.warn({ err: e }, "Ollama list failed");
    return [];
  }
}
