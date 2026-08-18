/**
 * Catalogue des modèles LLM — source unique de vérité.
 *
 * POURQUOI CE FICHIER
 * La liste des modèles Anthropic était dupliquée entre le formulaire
 * (`agent-form.tsx`, avec libellés) et la validation serveur
 * (`agents/actions.ts`, valeurs nues). Deux copies à tenir synchronisées,
 * qui deviennent six dès qu'on ajoute un troisième fournisseur.
 *
 * ÉTAT ACTUEL — UN SEUL FOURNISSEUR PROPOSABLE
 * Tant que les configurations LLM personnelles n'existent pas, un agent
 * Anthropic consommerait la clé `ANTHROPIC_API_KEY` de l'établissement,
 * sans rattachement à qui que ce soit. On ne propose donc que l'Ollama
 * mutualisé de l'UN-CHK, avec un modèle unique.
 *
 * Anthropic (et OpenAI) reviendront quand un enseignant pourra déclarer
 * SA clé : le catalogue les décrit déjà, seul `SELECTABLE_PROVIDERS`
 * les retient. C'est la seule ligne à changer le jour venu.
 */

export type CatalogModel = {
  value: string;
  label: string;
};

/* ─── Fournisseurs proposables ────────────────────────────────────────── */

/**
 * Fournisseurs qu'un utilisateur peut choisir aujourd'hui.
 *
 * L'enum Prisma `LLMProvider` en connaît davantage : un agent créé avant
 * cette restriction reste valide en base et continue de tourner. Cette
 * liste ne gouverne que ce qu'on ACCEPTE en création ou modification.
 */
export const SELECTABLE_PROVIDERS: readonly string[] = ["OLLAMA"];

export function isProviderSelectable(provider: string): boolean {
  return SELECTABLE_PROVIDERS.includes(provider);
}

/* ─── Ollama mutualisé (fromager) ─────────────────────────────────────── */

/**
 * Le seul modèle exposé sur l'Ollama mutualisé.
 *
 * Pas une famille, pas un motif : une valeur exacte. Le serveur héberge
 * cinq autres modèles, dont `claude-coder` et `qwen3.6` à 23,9 Go, et
 * chaque bascule de l'un à l'autre évince le précédent de la VRAM — ce
 * qui coûte ~44 s de rechargement au message suivant (mesuré le
 * 11/08/2026). Laisser le choix, c'est laisser dégrader le service pour
 * tout le monde.
 */
export const SHARED_OLLAMA_MODEL = "gemma3:12b";

export const SHARED_OLLAMA_MODELS: readonly string[] = [SHARED_OLLAMA_MODEL];

export function isOllamaModelAllowed(model: string): boolean {
  return SHARED_OLLAMA_MODELS.includes(model);
}

/**
 * Modèles utilisés par la plateforme mais JAMAIS proposés à l'utilisateur.
 *
 * `nomic-embed-text` sert à l'indexation RAG (`bot/rag.py`,
 * `src/lib/embeddings.ts`). Il n'a pas de sens comme modèle de
 * conversation, et les vecteurs déjà indexés lui sont liés : en changer
 * les rendrait incomparables. Il doit rester invisible côté interface.
 */
export const RAG_EMBEDDING_MODEL = "nomic-embed-text";

export function isInternalModel(model: string): boolean {
  return model.startsWith(RAG_EMBEDDING_MODEL) || /embed/i.test(model);
}

/* ─── Anthropic — décrit, pas encore proposable ───────────────────────── */

export const ANTHROPIC_MODELS: readonly CatalogModel[] = [
  { value: "claude-opus-4-7", label: "Claude Opus 4.7 (le + capable, US)" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (équilibré, US)" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (rapide & éco, US)" },
] as const;

export const ANTHROPIC_MODEL_VALUES: readonly string[] = ANTHROPIC_MODELS.map(
  (m) => m.value,
);

/* ─── OpenAI — décrit, pas encore proposable ──────────────────────────── */

/**
 * Modèles OpenAI exclus de la découverte : tout ce qui n'est pas utilisable
 * en complétion de chat (plongements, transcription, synthèse vocale,
 * images, modération, temps réel, audio, recherche).
 */
export const OPENAI_MODEL_EXCLUDE =
  /embedding|whisper|tts|dall-e|moderation|davinci-002|babbage-002|realtime|audio|search/i;

export function isOpenaiModelAllowed(model: string): boolean {
  return /^gpt-/i.test(model) && !OPENAI_MODEL_EXCLUDE.test(model);
}

/* ─── Validation ──────────────────────────────────────────────────────── */

/**
 * Le modèle est-il autorisé pour ce fournisseur ?
 *
 * Ne dit RIEN de la disponibilité réelle du modèle chez le fournisseur —
 * un refine zod est synchrone et n'ira pas interroger un serveur distant
 * à chaque soumission. La découverte répond « existe-t-il », cette
 * fonction répond « a-t-il le droit d'être choisi ».
 *
 * Un fournisseur inconnu renvoie `false` : on refuse par défaut.
 */
export function isModelAllowed(provider: string, model: string): boolean {
  switch (provider) {
    case "OLLAMA":
      return isOllamaModelAllowed(model);
    case "ANTHROPIC":
      return ANTHROPIC_MODEL_VALUES.includes(model);
    case "OPENAI":
      return isOpenaiModelAllowed(model);
    default:
      return false;
  }
}

/** Message d'erreur adapté au fournisseur, pour le champ `model`. */
export function modelErrorFor(provider: string): string {
  switch (provider) {
    case "OLLAMA":
      return `Seul le modèle ${SHARED_OLLAMA_MODEL} est disponible sur l'Ollama UN-CHK`;
    case "ANTHROPIC":
      return "Modèle Anthropic invalide";
    case "OPENAI":
      return "Modèle OpenAI invalide (attendu : gpt-*, hors embeddings et audio)";
    default:
      return "Fournisseur inconnu";
  }
}

/** Message d'erreur pour le champ `provider`. */
export function providerErrorFor(provider: string): string {
  if (provider === "ANTHROPIC" || provider === "OPENAI") {
    return "Ce fournisseur nécessite votre propre clé API — fonctionnalité à venir. Utilisez l'Ollama UN-CHK en attendant.";
  }
  return "Fournisseur non disponible";
}
