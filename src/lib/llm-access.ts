/**
 * Visibilité et modification des configurations LLM.
 *
 * POLITIQUE
 *   - SHARED   : visible par tous, modifiable par ADMIN seul. C'est le
 *                catalogue commun (Ollama UN-CHK).
 *   - PERSONAL : visible et modifiable par son propriétaire UNIQUEMENT.
 *                L'ADMIN ne la voit pas non plus — choix assumé : elle
 *                porte une clé API que son propriétaire paie de sa poche.
 *
 * Un seul point d'entrée pour toutes les vérifications. Une règle
 * dupliquée dans une route finit toujours par diverger du modèle.
 */
import type { LlmConfig, LlmScope, UserRole } from "@prisma/client";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export type LlmCtx = {
  role: UserRole;
  userId: string;
};

/** Ce qu'on expose au client. Ne contient JAMAIS `apiKeyEnc`. */
export const LLM_PUBLIC_SELECT = {
  id: true,
  name: true,
  provider: true,
  apiUrl: true,
  model: true,
  scope: true,
  userId: true,
  isDefault: true,
  isActive: true,
  createdAt: true,
} as const;

/**
 * Filtre Prisma des configs visibles par cet utilisateur.
 *
 * Un OR, car il voit deux ensembles à la fois : le catalogue partagé et
 * les siennes.
 */
export function visibleLlmsFilter(ctx: LlmCtx) {
  return {
    OR: [
      { scope: "SHARED" as LlmScope },
      { scope: "PERSONAL" as LlmScope, userId: ctx.userId },
    ],
  };
}

/** Peut voir l'existence et les métadonnées — jamais la clé en clair. */
export function canViewLlm(
  ctx: LlmCtx,
  llm: Pick<LlmConfig, "scope" | "userId">,
): boolean {
  if (llm.scope === "SHARED") return true;
  return llm.userId === ctx.userId;
}

/** Peut modifier : SHARED réservé à l'ADMIN, PERSONAL au propriétaire. */
export function canModifyLlm(
  ctx: LlmCtx,
  llm: Pick<LlmConfig, "scope" | "userId">,
): boolean {
  if (llm.scope === "SHARED") return can(ctx.role, "llm.manage-shared");
  return llm.userId === ctx.userId;
}

/**
 * Peut supprimer.
 *
 * Garde-fou : on refuse de supprimer une config SHARED qui est le défaut
 * d'usine actif. Elle sert de repli à tous les comptes ; la retirer
 * priverait de LLM tous les utilisateurs sans choix personnel.
 */
export function canDeleteLlm(
  ctx: LlmCtx,
  llm: Pick<LlmConfig, "scope" | "userId" | "isDefault" | "isActive">,
): { ok: true } | { ok: false; reason: string } {
  if (llm.scope === "SHARED") {
    if (!can(ctx.role, "llm.manage-shared")) {
      return { ok: false, reason: "Réservé à un administrateur." };
    }
    if (llm.isDefault && llm.isActive) {
      return {
        ok: false,
        reason:
          "C'est le fournisseur par défaut de la plateforme — le supprimer priverait de LLM tous les utilisateurs sans configuration personnelle. Désignez d'abord un autre défaut partagé.",
      };
    }
    return { ok: true };
  }
  return llm.userId === ctx.userId
    ? { ok: true }
    : { ok: false, reason: "Vous n'êtes pas propriétaire de cette configuration." };
}

export type ResolveResult =
  | { ok: true; llm: LlmConfig }
  | { ok: false; error: string };

/**
 * Résout la configuration à rattacher à un agent.
 *
 * Ordre : choix explicite → défaut personnel → défaut d'usine partagé.
 *
 * Contrairement à moodlescoutv2 où la résolution a lieu à chaque audit,
 * elle a lieu ici à l'enregistrement de l'agent : un agent est permanent,
 * et le bot Python doit savoir quelle clé utiliser sans réinterroger la
 * chaîne à chaque message.
 */
export async function resolveEffectiveLlm(
  ctx: LlmCtx,
  requestedId: string | null | undefined,
): Promise<ResolveResult> {
  if (requestedId) {
    const llm = await prisma.llmConfig.findUnique({ where: { id: requestedId } });
    // 404 volontaire plutôt qu'un refus explicite : ne pas révéler qu'une
    // configuration personnelle d'un autre utilisateur existe.
    if (!llm || !canViewLlm(ctx, llm)) {
      return { ok: false, error: "Configuration LLM introuvable." };
    }
    if (!llm.isActive) {
      return { ok: false, error: "Cette configuration LLM est désactivée." };
    }
    return { ok: true, llm };
  }

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { defaultLlmConfigId: true },
  });
  if (user?.defaultLlmConfigId) {
    const llm = await prisma.llmConfig.findUnique({
      where: { id: user.defaultLlmConfigId },
    });
    // Supprimée ou désactivée entre-temps : on tombe sur le repli partagé.
    if (llm && canViewLlm(ctx, llm) && llm.isActive) return { ok: true, llm };
  }

  const fallback = await prisma.llmConfig.findFirst({
    where: { scope: "SHARED", isDefault: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (fallback) return { ok: true, llm: fallback };

  return {
    ok: false,
    error:
      "Aucun fournisseur LLM disponible. Contactez un administrateur pour qu'il active au moins une configuration partagée.",
  };
}
