"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertCan, can } from "@/lib/permissions";
import { encrypt } from "@/lib/crypto";
import { probeProvider } from "@/lib/llm-providers";
import {
  canDeleteLlm,
  canModifyLlm,
  canViewLlm,
  type LlmCtx,
} from "@/lib/llm-access";
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "llm.actions" });

export type LlmFormState =
  | { error?: string; fieldErrors?: Record<string, string[]>; ok?: string }
  | undefined;

/** Fournisseurs qu'un utilisateur peut déclarer à titre personnel. */
const PERSONAL_PROVIDERS = ["ANTHROPIC", "OPENAI"] as const;

async function ctx(): Promise<LlmCtx> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  return { role: session.user.role, userId: session.user.id };
}

const createSchema = z.object({
  name: z.string().min(2, "2 caractères minimum").max(60),
  provider: z.enum(PERSONAL_PROVIDERS),
  apiKey: z.string().min(20, "Clé trop courte pour être valide").max(400),
  model: z.string().min(1, "Choisissez un modèle").max(120),
});

/**
 * Teste une clé sans rien enregistrer, et renvoie les modèles disponibles.
 *
 * Appelé par le formulaire avant la création : c'est ce qui permet de
 * remplacer la saisie libre du modèle par une liste réelle.
 */
export async function probeLlmKey(
  provider: string,
  apiKey: string,
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  const c = await ctx();
  assertCan(c.role, "llm.manage-own");
  if (!(PERSONAL_PROVIDERS as readonly string[]).includes(provider)) {
    return { ok: false, error: "Fournisseur non pris en charge." };
  }
  if (!apiKey || apiKey.length < 20) {
    return { ok: false, error: "Renseignez d'abord une clé API." };
  }
  const res = await probeProvider(provider, apiKey);
  // Journalise l'issue, jamais la clé.
  log.info({ provider, ok: res.ok, userId: c.userId }, "probe clé LLM");
  return res;
}

/** Déclare une configuration personnelle. La clé est chiffrée au repos. */
export async function createLlmConfig(
  _prev: LlmFormState,
  formData: FormData,
): Promise<LlmFormState> {
  const c = await ctx();
  assertCan(c.role, "llm.manage-own");

  const parsed = createSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
    provider: String(formData.get("provider") ?? ""),
    apiKey: String(formData.get("apiKey") ?? "").trim(),
    model: String(formData.get("model") ?? "").trim(),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) {
      const k = String(i.path[0] ?? "_");
      (fieldErrors[k] ??= []).push(i.message);
    }
    return { fieldErrors };
  }
  const { name, provider, apiKey, model } = parsed.data;

  // La clé doit être valide AVANT d'être stockée : une config qui ne
  // fonctionne pas ne se découvrirait qu'au premier message d'un étudiant.
  const probe = await probeProvider(provider, apiKey);
  if (!probe.ok) return { fieldErrors: { apiKey: [probe.error] } };
  if (!probe.models.includes(model)) {
    return { fieldErrors: { model: ["Ce modèle n'est pas accessible avec cette clé."] } };
  }

  const created = await prisma.llmConfig.create({
    data: {
      name,
      provider,
      apiKeyEnc: encrypt(apiKey),
      model,
      scope: "PERSONAL",
      userId: c.userId,
      isDefault: false,
      isActive: true,
    },
    select: { id: true },
  });
  log.info({ id: created.id, provider, userId: c.userId }, "config LLM créée");
  revalidatePath("/llm");
  return { ok: `Fournisseur « ${name} » enregistré.` };
}

/** Supprime une configuration. Le garde-fou du défaut d'usine s'applique. */
export async function deleteLlmConfig(id: string): Promise<LlmFormState> {
  const c = await ctx();
  const llm = await prisma.llmConfig.findUnique({ where: { id } });
  // Introuvable ET invisible renvoient le même message : on ne révèle pas
  // l'existence de la configuration personnelle d'un autre utilisateur.
  if (!llm || !canViewLlm(c, llm)) return { error: "Configuration introuvable." };

  const verdict = canDeleteLlm(c, llm);
  if (!verdict.ok) return { error: verdict.reason };

  await prisma.llmConfig.delete({ where: { id } });
  log.info({ id, userId: c.userId }, "config LLM supprimée");
  revalidatePath("/llm");
  revalidatePath("/agents");
  return { ok: "Configuration supprimée." };
}

/** Active ou désactive une configuration sans la supprimer. */
export async function toggleLlmActive(id: string): Promise<LlmFormState> {
  const c = await ctx();
  const llm = await prisma.llmConfig.findUnique({ where: { id } });
  if (!llm || !canViewLlm(c, llm)) return { error: "Configuration introuvable." };
  if (!canModifyLlm(c, llm)) return { error: "Modification non autorisée." };
  if (llm.scope === "SHARED" && llm.isDefault && llm.isActive) {
    return {
      error:
        "C'est le fournisseur par défaut de la plateforme — le désactiver priverait de LLM tous les comptes sans configuration personnelle.",
    };
  }
  await prisma.llmConfig.update({
    where: { id },
    data: { isActive: !llm.isActive },
  });
  revalidatePath("/llm");
  return { ok: llm.isActive ? "Configuration désactivée." : "Configuration réactivée." };
}

/**
 * Choisit le fournisseur par défaut de l'utilisateur courant.
 * `null` remet le défaut d'usine partagé (Ollama UN-CHK).
 */
export async function setDefaultLlm(id: string | null): Promise<LlmFormState> {
  const c = await ctx();
  if (id !== null) {
    const llm = await prisma.llmConfig.findUnique({ where: { id } });
    if (!llm || !canViewLlm(c, llm)) return { error: "Configuration introuvable." };
    if (!llm.isActive) return { error: "Cette configuration est désactivée." };
  }
  await prisma.user.update({
    where: { id: c.userId },
    data: { defaultLlmConfigId: id },
  });
  revalidatePath("/llm");
  revalidatePath("/agents");
  return { ok: id ? "Fournisseur par défaut mis à jour." : "Retour au fournisseur de l'établissement." };
}

/** Réservé ADMIN : bascule le défaut d'usine partagé. */
export async function setSharedDefault(id: string): Promise<LlmFormState> {
  const c = await ctx();
  if (!can(c.role, "llm.manage-shared")) return { error: "Réservé à un administrateur." };
  const llm = await prisma.llmConfig.findUnique({ where: { id } });
  if (!llm || llm.scope !== "SHARED") return { error: "Configuration partagée introuvable." };

  await prisma.$transaction([
    prisma.llmConfig.updateMany({
      where: { scope: "SHARED", isDefault: true },
      data: { isDefault: false },
    }),
    prisma.llmConfig.update({
      where: { id },
      data: { isDefault: true, isActive: true },
    }),
  ]);
  log.info({ id, byUserId: c.userId }, "défaut d'usine partagé changé");
  revalidatePath("/llm");
  return { ok: "Défaut de la plateforme mis à jour." };
}
