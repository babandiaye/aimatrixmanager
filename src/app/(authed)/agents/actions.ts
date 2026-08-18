"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertCan, can, canAny } from "@/lib/permissions";
import { resolveEffectiveLlm } from "@/lib/llm-access";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  buildMxid,
  clientLoginWithPassword,
  deactivateUser,
  resetUserPassword,
  setUserDisplayName,
  upsertUser,
  userExists,
} from "@/lib/synapse-admin";
import { setupCrossSigningForAgent, signAgentDevice } from "@/lib/agent-cross-signing";
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "agents.actions" });

/**
 * Vérifie qu'un user a le droit d'agir sur cet agent : soit perm globale,
 * soit perm `*-own` ET il est le créateur. Throw "Forbidden" sinon.
 * Utilisé par update/delete/setStatus/rotateToken/signDevice.
 */
async function assertAgentEditable(
  role: string,
  userId: string,
  agentId: string,
  action: "update" | "delete",
): Promise<void> {
  const globalPerm = action === "update" ? "agents.update" : "agents.delete";
  const ownPerm = action === "update" ? "agents.update-own" : "agents.delete-own";

  if (can(role as never, globalPerm)) return; // ADMIN/MANAGER passent direct
  if (!can(role as never, ownPerm)) {
    throw new Error(`Forbidden: rôle ${role} n'a pas la permission ${globalPerm}`);
  }
  // ENSEIGNANT : doit être le créateur
  const a = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { createdById: true },
  });
  if (!a || a.createdById !== userId) {
    throw new Error("Forbidden: vous n'êtes pas le créateur de cet agent");
  }
}

const slugRe = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

// Schéma base (objet pur — autorise .omit() / .pick() / .extend())
const baseSchemaObject = z.object({
  slug: z
    .string()
    .min(2, "2 caractères minimum")
    .max(32, "32 caractères maximum")
    .regex(
      slugRe,
      "Lettres minuscules, chiffres, tirets ; ne commence/finit pas par un tiret",
    ),
  name: z.string().min(2, "2 caractères minimum").max(100),
  description: z
    .string()
    .max(2048)
    .optional()
    .transform((v) => v?.trim() || null),
  systemPrompt: z.string().min(10, "Au moins 10 caractères").max(40000),
  llmConfigId: z.string().max(64),
  maxTokens: z.coerce.number().int().min(64).max(8192),
  temperature: z.coerce
    .number()
    .min(0)
    .max(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

// La cohérence (fournisseur, modèle) n'a plus à être vérifiée ici : elle est
// garantie à la création de la configuration LLM, où le modèle est choisi
// dans la liste renvoyée par le fournisseur lui-même. Revalider contre notre
// catalogue statique rejetterait à tort les modèles auxquels la clé
// personnelle d'un enseignant donne accès.

export type AgentFormState =
  | { error?: string; fieldErrors?: Record<string, string[]> }
  | undefined;

function getFormData(formData: FormData) {
  const t = String(formData.get("temperature") ?? "").trim();
  return {
    slug: String(formData.get("slug") ?? "").trim().toLowerCase(),
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? ""),
    systemPrompt: String(formData.get("systemPrompt") ?? "").trim(),
    // Le formulaire ne choisit plus un couple (fournisseur, modèle) : il
    // désigne une configuration LLM. Le serveur en dérive provider et model,
    // ce qui rend impossible une combinaison incohérente envoyée à la main.
    // Vide = « fournisseur par défaut », résolu côté serveur.
    llmConfigId: String(formData.get("llmConfigId") ?? "").trim(),
    maxTokens: String(formData.get("maxTokens") ?? "2048"),
    temperature: t === "" ? undefined : t,
  };
}

export async function createAgent(
  _prev: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "agents.create");

  const parsed = baseSchemaObject.safeParse(getFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // Résolution du fournisseur : choix explicite, sinon défaut personnel,
  // sinon défaut d'usine partagé. Une config invisible renvoie « introuvable ».
  const llmRes = await resolveEffectiveLlm(
    { role: session.user.role, userId: session.user.id },
    parsed.data.llmConfigId || null,
  );
  if (!llmRes.ok) return { fieldErrors: { llmConfigId: [llmRes.error] } };
  const llm = llmRes.llm;

  // Unicité slug + matrixUserId
  const mxid = buildMxid(parsed.data.slug);
  const existing = await prisma.agent.findFirst({
    where: { OR: [{ slug: parsed.data.slug }, { matrixUserId: mxid }] },
    select: { id: true },
  });
  if (existing) {
    return { fieldErrors: { slug: ["Ce slug est déjà utilisé"] } };
  }

  // Vérifie que le MXID n'existe pas déjà côté Matrix (vieux compte orphelin par ex.)
  if (await userExists(parsed.data.slug)) {
    return {
      fieldErrors: {
        slug: [
          `Le compte Matrix ${mxid} existe déjà côté Synapse — choisis un autre slug.`,
        ],
      },
    };
  }

  // 1. Provision Matrix : crée le compte avec un password aléatoire,
  //    puis client login classique pour obtenir access_token + device_id (E2EE).
  const password = crypto.randomBytes(24).toString("base64");
  let accessToken: string;
  let deviceId: string;
  try {
    await upsertUser({
      localpart: parsed.data.slug,
      password,
      displayname: parsed.data.name,
      admin: false,
    });
    const login = await clientLoginWithPassword(parsed.data.slug, password);
    accessToken = login.access_token;
    deviceId = login.device_id;
  } catch (e) {
    log.error({ err: e }, "Échec provisioning Matrix");
    return {
      error:
        e instanceof Error
          ? `Provisioning Matrix échoué : ${e.message}`
          : "Provisioning Matrix échoué",
    };
  }

  // 2. Insertion DB (token chiffré + device_id)
  const created = await prisma.agent.create({
    data: {
      slug: parsed.data.slug,
      name: parsed.data.name,
      description: parsed.data.description,
      matrixUserId: mxid,
      matrixAccessToken: encrypt(accessToken),
      matrixDeviceId: deviceId,
      systemPrompt: parsed.data.systemPrompt,
      llmConfigId: llm.id,
      // provider et model sont recopiés depuis la configuration : le bot
      // Python les lit encore directement. Ils resteront synchronisés tant
      // qu'ils n'auront pas été retirés du modèle Agent.
      provider: llm.provider,
      model: llm.model,
      maxTokens: parsed.data.maxTokens,
      temperature: parsed.data.temperature ?? null,
      status: "DISABLED", // toujours désactivé par défaut, l'admin active après
      createdById: session.user.id,
    },
    select: { id: true },
  });

  // 3. Cross-signing E2EE (best-effort) — élimine le bouclier rouge dans
  //    Element. Le password est encore en mémoire (pour l'UIA), c'est le
  //    seul moment opportun. Si ça échoue (Synapse refuse, réseau down),
  //    on log mais on n'annule pas la création — l'admin peut retenter via
  //    rotateAgentToken qui régénère un password et relance le setup.
  try {
    await setupCrossSigningForAgent({
      agentId: created.id,
      userId: mxid,
      localpart: parsed.data.slug,
      password,
      accessToken,
    });
  } catch (e) {
    log.warn(
      { err: e, slug: parsed.data.slug },
      "Setup cross-signing échoué (agent créé sans XS — retry via rotateAgentToken)",
    );
  }

  log.info({ slug: parsed.data.slug, mxid }, "Agent créé");
  revalidatePath("/agents");
  redirect("/agents");
}

export async function updateAgent(
  id: string,
  _prev: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  await assertAgentEditable(session.user.role, session.user.id, id, "update");

  // À l'édition, le slug n'est pas modifiable (le MXID Matrix est figé)
  // → on omit() sur l'objet pur (sans refine) puis on réapplique le refine
  const updateSchema = baseSchemaObject.omit({ slug: true });
  const parsed = updateSchema.safeParse({
    ...getFormData(formData),
    slug: undefined,
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // Récupère le slug + ancien nom pour décider si on doit synchroniser Matrix
  const before = await prisma.agent.findUniqueOrThrow({
    where: { id },
    select: { slug: true, name: true },
  });

  const llmRes = await resolveEffectiveLlm(
    { role: session.user.role, userId: session.user.id },
    parsed.data.llmConfigId || null,
  );
  if (!llmRes.ok) return { fieldErrors: { llmConfigId: [llmRes.error] } };
  const llm = llmRes.llm;

  await prisma.agent.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      systemPrompt: parsed.data.systemPrompt,
      llmConfigId: llm.id,
      provider: llm.provider,
      model: llm.model,
      maxTokens: parsed.data.maxTokens,
      temperature: parsed.data.temperature ?? null,
    },
  });

  // Si le nom a changé, propage le displayname côté Matrix (best-effort)
  if (before.name !== parsed.data.name) {
    try {
      await setUserDisplayName(before.slug, parsed.data.name);
    } catch (e) {
      log.warn(
        { err: e, slug: before.slug },
        "Échec sync displayname Matrix (DB déjà à jour)",
      );
    }
  }

  revalidatePath("/agents");
  revalidatePath(`/agents/${id}/edit`);
  redirect("/agents");
}

export async function setAgentStatus(
  id: string,
  status: "ENABLED" | "DISABLED" | "SUSPENDED",
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  await assertAgentEditable(session.user.role, session.user.id, id, "update");

  await prisma.agent.update({
    where: { id },
    data: { status },
  });
  revalidatePath("/agents");
}

/**
 * Supprime définitivement un agent :
 *  1. Désactive le compte Matrix côté Synapse (`deactivate`, irréversible)
 *  2. Supprime la row Agent (cascade → RoomAgent + AuditLog + AgentCrossSigning)
 *
 * Si la désactivation Matrix échoue (ex: réseau Synapse down), on stoppe
 * — pas d'orphan Matrix sans suppression DB ou inversement.
 */
export async function deleteAgent(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  await assertAgentEditable(session.user.role, session.user.id, id, "delete");

  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id },
    select: { slug: true, matrixUserId: true },
  });

  try {
    await deactivateUser(agent.slug);
    log.info(
      { slug: agent.slug, mxid: agent.matrixUserId },
      "Agent désactivé côté Matrix",
    );
  } catch (e) {
    // M_NOT_FOUND : le compte Matrix n'existe déjà plus, on continue
    const msg = e instanceof Error ? e.message : String(e);
    if (!/M_NOT_FOUND/i.test(msg)) {
      log.error({ err: e, slug: agent.slug }, "Échec désactivation Matrix");
      throw new Error(
        `Désactivation Matrix échouée — agent non supprimé : ${msg}`,
      );
    }
    log.info({ slug: agent.slug }, "Compte Matrix déjà absent, on continue");
  }

  await prisma.agent.delete({ where: { id } });
  log.info({ slug: agent.slug }, "Agent supprimé");
  revalidatePath("/agents");
}

/**
 * Régénère le matrixAccessToken ET le device_id (reset password admin →
 * client login). Utile si le précédent est compromis ou pour un agent
 * créé via l'ancien admin /login (sans device_id).
 */
export async function rotateAgentToken(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  await assertAgentEditable(session.user.role, session.user.id, id, "update");

  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id },
    select: { slug: true, matrixUserId: true },
  });
  const password = crypto.randomBytes(24).toString("base64");
  await resetUserPassword(agent.slug, password);
  const login = await clientLoginWithPassword(agent.slug, password);
  await prisma.agent.update({
    where: { id },
    data: {
      matrixAccessToken: encrypt(login.access_token),
      matrixDeviceId: login.device_id,
    },
  });
  log.info(
    { slug: agent.slug, device: login.device_id },
    "Token + device rotated",
  );

  // Profite du password frais pour (re)faire le cross-signing — best-effort.
  // Si l'agent en avait déjà un, ses XS keys sont écrasées (upsert). Le
  // device fraîchement obtenu sera signé une fois que le bot l'aura uploadé
  // via /keys/upload (cf. signAgentDevice après bot start).
  try {
    await setupCrossSigningForAgent({
      agentId: id,
      userId: agent.matrixUserId,
      localpart: agent.slug,
      password,
      accessToken: login.access_token,
    });
  } catch (e) {
    log.warn(
      { err: e, slug: agent.slug },
      "Re-setup cross-signing échoué (token rotaté mais XS pas mises à jour)",
    );
  }

  revalidatePath("/agents");
}

/**
 * Signe le device courant de l'agent avec sa SSK déjà persistée. À appeler
 * APRÈS que le bot Python ait démarré (et donc uploadé ses device_keys via
 * matrix-nio). Retourne `{ok: true}` ou `{ok: false, error: <message>}` —
 * ne throw pas (sinon Next.js prod masque le message en 500 générique).
 */
export type SignDeviceResult =
  | { ok: true }
  | { ok: false; error: string; hint?: string };

export async function signAgentDeviceAction(
  id: string,
): Promise<SignDeviceResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized" };
  try {
    await assertAgentEditable(
      session.user.role,
      session.user.id,
      id,
      "update",
    );
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Permission insuffisante",
    };
  }

  const agent = await prisma.agent.findUnique({
    where: { id },
    select: {
      slug: true,
      matrixUserId: true,
      matrixDeviceId: true,
      matrixAccessToken: true,
    },
  });
  if (!agent) return { ok: false, error: "Agent introuvable" };
  if (!agent.matrixDeviceId || !agent.matrixAccessToken) {
    return {
      ok: false,
      error: "L'agent n'a pas de device_id / access_token",
      hint: "Régénère le token d'abord.",
    };
  }

  try {
    await signAgentDevice({
      agentId: id,
      userId: agent.matrixUserId,
      deviceId: agent.matrixDeviceId,
      accessToken: decrypt(agent.matrixAccessToken),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/device_keys absent/i.test(msg)) {
      return {
        ok: false,
        error: "Le bot Python n'a pas encore uploadé ses device_keys.",
        hint:
          "Attends ~60s après un rotate (la reconcile_loop redémarre le runner et matrix-nio appelle keys/upload), puis réessaie.",
      };
    }
    log.error(
      { err: msg, slug: agent.slug },
      "Échec signature device — erreur non récupérable",
    );
    return { ok: false, error: msg };
  }

  log.info(
    { slug: agent.slug, deviceId: agent.matrixDeviceId },
    "Device signé manuellement par l'admin",
  );
  revalidatePath("/agents");
  return { ok: true };
}

// ─── Actions groupées ───────────────────────────────────────────────────────
//
// Le résultat est partiel par conception : un agent en échec (droits
// insuffisants, compte Matrix récalcitrant) ne doit pas annuler le
// traitement des autres. On renvoie le détail pour que l'UI puisse
// nommer précisément ce qui a échoué.

/** Garde-fou : au-delà, c'est un usage anormal de l'UI. */
const BULK_MAX = 100;

export type BulkResult = {
  ok: number;
  failed: Array<{ id: string; label: string; error: string }>;
};

function assertBulkInput(ids: string[]): void {
  if (ids.length === 0) throw new Error("Aucun agent sélectionné");
  if (ids.length > BULK_MAX) {
    throw new Error(`Trop d'agents sélectionnés (max ${BULK_MAX})`);
  }
}

/**
 * Change le statut de plusieurs agents. L'ownership est revérifié agent
 * par agent — un ENSEIGNANT ne peut agir que sur les siens, même si
 * l'interface lui en proposait d'autres.
 */
export async function bulkSetAgentStatus(
  ids: string[],
  status: "ENABLED" | "DISABLED" | "SUSPENDED",
): Promise<BulkResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertBulkInput(ids);

  const result: BulkResult = { ok: 0, failed: [] };

  for (const id of ids) {
    try {
      await assertAgentEditable(session.user.role, session.user.id, id, "update");
      await prisma.agent.update({ where: { id }, data: { status } });
      result.ok++;
    } catch (e) {
      const agent = await prisma.agent.findUnique({
        where: { id },
        select: { slug: true },
      });
      result.failed.push({
        id,
        label: agent?.slug ?? id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  log.info(
    { status, requested: ids.length, ok: result.ok, failed: result.failed.length },
    "Changement de statut groupé",
  );
  revalidatePath("/agents");
  return result;
}

/**
 * Supprime plusieurs agents : désactivation du compte Matrix puis
 * suppression en base (cascade sur les affectations).
 *
 * Comme pour la suppression unitaire, un échec de désactivation Matrix
 * empêche la suppression en base — mieux vaut un agent encore listé
 * qu'un compte Matrix orphelin, invisible depuis l'application.
 */
export async function bulkDeleteAgents(ids: string[]): Promise<BulkResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertBulkInput(ids);

  const result: BulkResult = { ok: 0, failed: [] };

  for (const id of ids) {
    let slug = id;
    try {
      await assertAgentEditable(session.user.role, session.user.id, id, "delete");
      const agent = await prisma.agent.findUniqueOrThrow({
        where: { id },
        select: { slug: true, matrixUserId: true },
      });
      slug = agent.slug;

      try {
        await deactivateUser(agent.slug);
      } catch (e) {
        // M_NOT_FOUND : le compte Matrix n'existe déjà plus, on continue.
        const msg = e instanceof Error ? e.message : String(e);
        if (!/M_NOT_FOUND/i.test(msg)) throw e;
        log.info({ slug: agent.slug }, "Compte Matrix déjà absent, on continue");
      }

      await prisma.agent.delete({ where: { id } });
      log.info({ slug: agent.slug }, "Agent supprimé (action groupée)");
      result.ok++;
    } catch (e) {
      result.failed.push({
        id,
        label: slug,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  log.info(
    { requested: ids.length, ok: result.ok, failed: result.failed.length },
    "Suppression groupée",
  );
  revalidatePath("/agents");
  return result;
}
