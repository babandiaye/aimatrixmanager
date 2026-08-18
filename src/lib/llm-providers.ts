/**
 * Appels de vérification vers les fournisseurs LLM.
 *
 * Sert au bouton « Tester la connexion » : on valide la clé AVANT
 * d'enregistrer quoi que ce soit, et on récupère la liste des modèles
 * réellement disponibles. C'est ce qui remplace une saisie libre du nom
 * de modèle — donc ce qui élimine les fautes de frappe et les modèles
 * inexistants.
 *
 * Aucune clé n'est journalisée : en cas d'échec on ne remonte que le code
 * HTTP et le message du fournisseur, jamais la requête.
 */
import { isOpenaiModelAllowed } from "@/lib/llm-catalog";

export type ProbeResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string };

const TIMEOUT_MS = 15_000;

async function getJson(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

function providerMessage(status: number, body: unknown): string {
  const msg =
    (body as { error?: { message?: string } } | null)?.error?.message ?? null;
  if (status === 401 || status === 403) {
    return "Clé refusée par le fournisseur — vérifiez qu'elle est active et complète.";
  }
  if (status === 429) {
    return "Fournisseur momentanément saturé (429). Réessayez dans un instant.";
  }
  return msg ? `HTTP ${status} — ${msg}` : `HTTP ${status}`;
}

/** Anthropic : GET /v1/models, en-tête x-api-key. */
export async function probeAnthropic(apiKey: string): Promise<ProbeResult> {
  try {
    const { status, body } = await getJson(
      "https://api.anthropic.com/v1/models?limit=100",
      { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    );
    if (status !== 200) return { ok: false, error: providerMessage(status, body) };
    const data = (body as { data?: { id?: string }[] } | null)?.data ?? [];
    const models = data.map((m) => String(m.id ?? "")).filter(Boolean).sort();
    return models.length
      ? { ok: true, models }
      : { ok: false, error: "Clé acceptée mais aucun modèle accessible." };
  } catch (e) {
    return { ok: false, error: describeNetwork(e) };
  }
}

/** OpenAI : GET /v1/models, filtré aux modèles de conversation. */
export async function probeOpenai(apiKey: string): Promise<ProbeResult> {
  try {
    const { status, body } = await getJson("https://api.openai.com/v1/models", {
      Authorization: `Bearer ${apiKey}`,
    });
    if (status !== 200) return { ok: false, error: providerMessage(status, body) };
    const data = (body as { data?: { id?: string }[] } | null)?.data ?? [];
    const models = data
      .map((m) => String(m.id ?? ""))
      .filter(isOpenaiModelAllowed)
      .sort();
    return models.length
      ? { ok: true, models }
      : {
          ok: false,
          error:
            "Clé acceptée mais aucun modèle de conversation disponible sur ce compte.",
        };
  } catch (e) {
    return { ok: false, error: describeNetwork(e) };
  }
}

function describeNetwork(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "AbortError") {
    return `Le fournisseur n'a pas répondu en ${TIMEOUT_MS / 1000} s.`;
  }
  return "Impossible de joindre le fournisseur — vérifiez la connectivité du serveur.";
}

export async function probeProvider(
  provider: string,
  apiKey: string,
): Promise<ProbeResult> {
  switch (provider) {
    case "ANTHROPIC":
      return probeAnthropic(apiKey);
    case "OPENAI":
      return probeOpenai(apiKey);
    default:
      return { ok: false, error: `Fournisseur non testable : ${provider}` };
  }
}
