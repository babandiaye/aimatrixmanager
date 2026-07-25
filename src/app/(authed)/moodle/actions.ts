"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { encrypt } from "@/lib/crypto";
import {
  getSiteInfo,
  listCourses,
  listMatrixActivities,
  MoodleWSError,
} from "@/lib/moodle-ws";
import { syncCourseContentsCore } from "@/lib/moodle-course-sync";
import { syncMatrixActivitiesForPlatformCore } from "@/lib/moodle-matrix-sync";
import { extractCourseContents } from "@/lib/rag-indexer";
import { enqueueRagIndex, getRagJobStatusByCourse } from "@/lib/queue/rag";
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "moodle.actions" });

const platformSchema = z.object({
  key: z
    .string()
    .min(2, "2 caractères minimum")
    .max(20, "20 caractères maximum")
    .regex(
      /^[A-Z0-9_-]+$/,
      "Lettres majuscules, chiffres, tirets et underscores uniquement",
    ),
  name: z.string().min(2, "2 caractères minimum").max(100),
  baseUrl: z
    .string()
    .url("URL invalide")
    .refine((u) => /^https?:\/\//.test(u), "Doit commencer par http(s)://")
    .transform((u) => u.replace(/\/$/, "")), // pas de / final
  wsToken: z.string().min(1, "Token requis"),
  wsUsername: z.string().optional().transform((v) => v?.trim() || null),
  enabled: z.boolean().default(true),
});

export type PlatformFormState =
  | { error?: string; fieldErrors?: Record<string, string[]> }
  | undefined;

function getFormData(formData: FormData) {
  return {
    key: String(formData.get("key") ?? "").trim().toUpperCase(),
    name: String(formData.get("name") ?? "").trim(),
    baseUrl: String(formData.get("baseUrl") ?? "").trim(),
    wsToken: String(formData.get("wsToken") ?? "").trim(),
    wsUsername: String(formData.get("wsUsername") ?? "").trim(),
    enabled: formData.get("enabled") === "on",
  };
}

export async function createPlatform(
  _prev: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "moodle.create");

  const parsed = platformSchema.safeParse(getFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // Vérifie l'unicité de la key
  const existing = await prisma.moodlePlatform.findUnique({
    where: { key: parsed.data.key },
  });
  if (existing) {
    return { fieldErrors: { key: ["Cette clé est déjà utilisée"] } };
  }

  await prisma.moodlePlatform.create({
    data: {
      key: parsed.data.key,
      name: parsed.data.name,
      baseUrl: parsed.data.baseUrl,
      wsToken: encrypt(parsed.data.wsToken),
      wsUsername: parsed.data.wsUsername,
      enabled: parsed.data.enabled,
      createdById: session.user.id,
    },
  });

  revalidatePath("/moodle");
  redirect("/moodle");
}

export async function updatePlatform(
  id: string,
  _prev: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "moodle.update");

  // Le token est optionnel à l'édition (vide = on garde l'ancien)
  const updateSchema = platformSchema.extend({
    wsToken: z.string().optional().transform((v) => v?.trim() || ""),
  });

  const parsed = updateSchema.safeParse(getFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // Vérifie unicité de la key si elle change
  const existing = await prisma.moodlePlatform.findUnique({
    where: { key: parsed.data.key },
  });
  if (existing && existing.id !== id) {
    return { fieldErrors: { key: ["Cette clé est déjà utilisée"] } };
  }

  await prisma.moodlePlatform.update({
    where: { id },
    data: {
      key: parsed.data.key,
      name: parsed.data.name,
      baseUrl: parsed.data.baseUrl,
      wsUsername: parsed.data.wsUsername,
      enabled: parsed.data.enabled,
      // n'écrase wsToken que si une nouvelle valeur a été saisie (et chiffre)
      ...(parsed.data.wsToken && { wsToken: encrypt(parsed.data.wsToken) }),
    },
  });

  revalidatePath("/moodle");
  revalidatePath(`/moodle/${id}/edit`);
  redirect("/moodle");
}

// ── Test des prérequis d'une plateforme ────────────────────────────────────
// Vérifie que la plateforme est correctement configurée pour l'intégration
// aibotmanager. Le compte lié à `wsToken` doit avoir accès à un ensemble
// précis de fonctions webservice (config du service Moodle « External
// service » côté /admin/settings.php?section=externalservices).
//
// Chaque check est indépendant : on essaie de tous les faire même si un
// précédent a échoué, pour donner à l'utilisateur un rapport le plus
// complet possible en un seul aller-retour. Sauf pour la connectivité :
// si core_webservice_get_site_info échoue, tout le reste ne peut pas
// être testé (on n'a pas la liste des fonctions).

/**
 * Résultat d'un check individuel. `ok=true` = OK, `ok=false` = manquant,
 * `ok="warn"` = présent mais avec réserve (ex: cours vus par le token = 0).
 */
export type PlatformCheck = {
  ok: true | false | "warn";
  label: string;
  detail: string;
};

// Fonctions webservice réellement utilisées par le code aibotmanager.
// À maintenir en sync avec `src/lib/moodle-ws.ts` : ajouter ici tout
// nouveau `callMoodleWS(..., "fonction_ws", ...)`. Cette liste sert de
// contrat d'intégration côté Moodle admin (elles doivent toutes être
// cochées dans le service externe rattaché au token).
const REQUIRED_WS_FUNCTIONS: Array<{
  name: string;
  usedBy: string;
}> = [
  {
    name: "core_webservice_get_site_info",
    usedBy: "connectivité + test lui-même",
  },
  { name: "core_course_get_courses", usedBy: "sync des cours" },
  { name: "core_course_get_courses_by_field", usedBy: "sync des cours" },
  {
    name: "core_course_get_contents",
    usedBy: "RAG multi-fichiers (livres, ressources)",
  },
  {
    name: "core_user_get_users_by_field",
    usedBy: "résolution enseignant par email",
  },
  {
    name: "core_enrol_get_users_courses",
    usedBy: "liste des cours d'un utilisateur",
  },
  {
    name: "core_enrol_get_enrolled_users",
    usedBy: "rôles utilisateur (Enseignant/Tuteur) sur un cours",
  },
  {
    name: "mod_matrix_get_matrices_by_courses",
    usedBy: "activités mod_matrix + auto-link salons",
  },
];

export async function testMoodlePlatform(platformId: string): Promise<{
  platformName: string;
  baseUrl: string;
  checks: PlatformCheck[];
  okCount: number;
  warnCount: number;
  errorCount: number;
}> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "moodle.view");

  const platform = await prisma.moodlePlatform.findUniqueOrThrow({
    where: { id: platformId },
  });

  const checks: PlatformCheck[] = [];

  // 1. Connectivité + auth token — appel core_webservice_get_site_info.
  const t0 = Date.now();
  let siteInfo: Awaited<ReturnType<typeof getSiteInfo>> | null = null;
  try {
    siteInfo = await getSiteInfo(platform);
    const ms = Date.now() - t0;
    checks.push({
      ok: true,
      label: "Connectivité + token",
      detail: `réponse OK en ${ms} ms`,
    });
    checks.push({
      ok: true,
      label: "Compte service (userinfo)",
      detail: `${siteInfo.username} (userid=${siteInfo.userid}) — ${siteInfo.sitename}`,
    });
    checks.push({
      ok: true,
      label: "Version Moodle",
      detail: siteInfo.release || siteInfo.version || "inconnue",
    });
  } catch (e) {
    const msg =
      e instanceof MoodleWSError
        ? `[${e.errcode}] ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e);
    checks.push({
      ok: false,
      label: "Connectivité + token",
      detail: msg,
    });
    // Sans site_info, on ne peut pas tester le reste.
    return summarize(platform.name, platform.baseUrl, checks);
  }

  // 2. Vérification que TOUTES les fonctions requises sont exposées à ce token.
  const exposedNames = new Set(siteInfo.functions.map((f) => f.name));
  const missingFns = REQUIRED_WS_FUNCTIONS.filter(
    (f) => !exposedNames.has(f.name),
  );
  if (missingFns.length === 0) {
    checks.push({
      ok: true,
      label: `Fonctions webservice (${REQUIRED_WS_FUNCTIONS.length}/${REQUIRED_WS_FUNCTIONS.length})`,
      detail: "toutes les fonctions requises sont exposées au token",
    });
  } else {
    // core_course_get_courses ET core_course_get_courses_by_field :
    // on utilise l'un OU l'autre selon le call. Si UN des deux est présent
    // c'est OK — on downgrade en warn au lieu d'error.
    const onlyCoursesAlias =
      missingFns.length === 1 &&
      (missingFns[0].name === "core_course_get_courses" ||
        missingFns[0].name === "core_course_get_courses_by_field") &&
      exposedNames.has(
        missingFns[0].name === "core_course_get_courses"
          ? "core_course_get_courses_by_field"
          : "core_course_get_courses",
      );
    checks.push({
      ok: onlyCoursesAlias ? "warn" : false,
      label: `Fonctions webservice (${REQUIRED_WS_FUNCTIONS.length - missingFns.length}/${REQUIRED_WS_FUNCTIONS.length})`,
      detail:
        `Manquante(s) : ` +
        missingFns.map((f) => `${f.name} (${f.usedBy})`).join(", "),
    });
  }

  // 3. Zoom mod_matrix : présent + version pour aider au debug.
  const matrixFn = siteInfo.functions.find(
    (f) => f.name === "mod_matrix_get_matrices_by_courses",
  );
  if (matrixFn) {
    checks.push({
      ok: true,
      label: "Plugin mod_matrix",
      detail: `${matrixFn.name} v${matrixFn.version}`,
    });
  } else {
    checks.push({
      ok: false,
      label: "Plugin mod_matrix",
      detail:
        "Le plugin Famedly/mod_matrix n'est pas installé (ou pas exposé au token). Sans lui, aucune activité Matrix ne peut être importée.",
    });
  }

  // 4. Cours accessibles par le token : appel léger pour valider que le token
  //    a les droits sur core_course_get_courses. Signale si 0 → problème de
  //    capacité côté le rôle Moodle du compte service.
  try {
    const courses = await listCourses(platform);
    if (courses.length === 0) {
      checks.push({
        ok: "warn",
        label: "Cours visibles par le token",
        detail:
          "0 cours retourné — le compte service n'a peut-être pas la capability moodle/course:view ou l'instance n'a aucun cours.",
      });
    } else {
      checks.push({
        ok: true,
        label: "Cours visibles par le token",
        detail: `${courses.length} cours accessibles`,
      });
    }
  } catch (e) {
    const msg =
      e instanceof MoodleWSError
        ? `[${e.errcode}] ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e);
    checks.push({
      ok: false,
      label: "Cours visibles par le token",
      detail: msg,
    });
  }

  // 5. Test réel de listMatrixActivities si mod_matrix est là — validation
  //    end-to-end (utile car certaines instances exposent la fonction mais
  //    le token n'a pas moodle/course:view sur les cours cibles → retour
  //    silencieusement vide).
  if (matrixFn) {
    try {
      const acts = await listMatrixActivities(platform);
      checks.push({
        ok: acts.length === 0 ? "warn" : true,
        label: "mod_matrix_get_matrices_by_courses (appel réel)",
        detail:
          acts.length === 0
            ? "appel OK mais 0 activité — normal si aucun cours n'utilise mod_matrix (rappel : Moodle renvoie [] sans filtre courseids)"
            : `${acts.length} activité(s) retournée(s)`,
      });
    } catch (e) {
      const msg =
        e instanceof MoodleWSError
          ? `[${e.errcode}] ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      checks.push({
        ok: false,
        label: "mod_matrix_get_matrices_by_courses (appel réel)",
        detail: msg,
      });
    }
  }

  return summarize(platform.name, platform.baseUrl, checks);
}

function summarize(
  platformName: string,
  baseUrl: string,
  checks: PlatformCheck[],
) {
  return {
    platformName,
    baseUrl,
    checks,
    okCount: checks.filter((c) => c.ok === true).length,
    warnCount: checks.filter((c) => c.ok === "warn").length,
    errorCount: checks.filter((c) => c.ok === false).length,
  };
}

export async function togglePlatformEnabled(id: string, enabled: boolean) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "moodle.update");

  await prisma.moodlePlatform.update({
    where: { id },
    data: { enabled },
  });
  revalidatePath("/moodle");
}

export async function deletePlatform(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "moodle.delete");

  await prisma.moodlePlatform.delete({ where: { id } });
  revalidatePath("/moodle");
}

/** Sync les cours d'une plateforme Moodle vers la table MoodleCourse. */
export async function syncCoursesForPlatform(platformId: string): Promise<{
  total: number;
  inserted: number;
  updated: number;
}> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  // Lecture seule pour Manager/Auditor sur Moodle, mais sync est une action
  // de maintenance — autorisons rooms.assign (Admin/Manager).
  assertCan(session.user.role, "rooms.assign");

  const platform = await prisma.moodlePlatform.findUniqueOrThrow({
    where: { id: platformId },
  });

  const courses = await listCourses(platform);
  let inserted = 0,
    updated = 0;

  for (const c of courses) {
    const existing = await prisma.moodleCourse.findUnique({
      where: { platformId_moodleId: { platformId, moodleId: c.id } },
    });
    if (existing) {
      await prisma.moodleCourse.update({
        where: { id: existing.id },
        data: {
          shortname: c.shortname,
          fullname: c.fullname,
          lastSyncedAt: new Date(),
        },
      });
      updated++;
    } else {
      await prisma.moodleCourse.create({
        data: {
          platformId,
          moodleId: c.id,
          shortname: c.shortname,
          fullname: c.fullname,
          lastSyncedAt: new Date(),
        },
      });
      inserted++;
    }
  }

  await prisma.moodlePlatform.update({
    where: { id: platformId },
    data: { lastSyncedAt: new Date() },
  });

  log.info(
    { platform: platform.key, total: courses.length, inserted, updated },
    "Sync Moodle courses",
  );
  revalidatePath("/moodle");
  revalidatePath("/rooms");
  return { total: courses.length, inserted, updated };
}

/**
 * Sync les activités mod_matrix (instances du plugin Famedly) d'une plateforme
 * vers la table MoodleMatrixActivity. Idempotent : upsert par (platformId,
 * moodleId). Les activités disparues côté Moodle sont supprimées en DB.
 */
export async function syncMatrixActivitiesForPlatform(
  platformId: string,
): Promise<{
  total: number;
  inserted: number;
  updated: number;
  removed: number;
  linkedRooms: number;
  linkedByName: number;
}> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "rooms.assign");
  return syncMatrixActivitiesForPlatformCore(platformId);
}

// ─── RAG Phase 11 — sync structurel + pipeline en queue ─────────────────────
// La logique pure est dans `@/lib/moodle-course-sync` ; on l'expose ici
// derrière une vérif d'auth + revalidate. Le full reindex passe par la queue
// BullMQ (worker en background) pour ne pas bloquer le request handler.

/**
 * Sync la structure pédagogique (sections + resources) d'un cours Moodle vers
 * MoodleSection + MoodleResource. Idempotent. Wrapper auth de
 * `syncCourseContentsCore`.
 */
export async function syncCourseContents(courseDbId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "rooms.assign");

  const r = await syncCourseContentsCore(courseDbId);
  revalidatePath("/moodle");
  revalidatePath(`/rooms`);
  return r;
}

/**
 * Réindexe un cours pour le RAG : extrait le texte de toutes ses sections
 * et resources, regénère les chunks (sans embeddings — Phase 11e séparée).
 * Pré-requis : sync structurel déjà fait (syncCourseContents).
 */
export async function reindexCourseContents(courseDbId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "rooms.assign");

  const r = await extractCourseContents(courseDbId);
  revalidatePath("/moodle");
  revalidatePath("/rooms");
  return r;
}

/**
 * Pipeline complet d'indexation RAG d'un cours Moodle, **en arrière-plan via
 * BullMQ** :
 *   1. sync structurel (sections + resources)
 *   2. extraction texte + chunking (PDFs, pages, labels)
 *   3. embeddings via fromager
 *   4. flag reindexEnabled
 *
 * Retourne immédiatement avec le jobId — l'UI doit poll `getRagJobStatus`
 * pour suivre la progression. Si un job du même cours est déjà queued/active,
 * on retourne ce job existant (idempotence).
 */
export async function fullReindexCourse(courseDbId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "rooms.assign");

  const r = await enqueueRagIndex({
    courseDbId,
    triggeredBy: session.user.id,
  });
  log.info(
    { courseDbId, jobId: r.jobId, alreadyQueued: r.alreadyQueued },
    "Full reindex enqueued",
  );
  revalidatePath("/moodle");
  revalidatePath("/rooms");
  return r;
}

/**
 * Lit l'état d'un job RAG pour un cours (pour polling UI).
 */
export async function getRagJobStatus(courseDbId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  // Lecture seule, pas besoin de rooms.assign — toute personne qui voit
  // le cours peut poll le statut.
  return getRagJobStatusByCourse(courseDbId);
}

export async function toggleCourseReindex(
  courseDbId: string,
  enabled: boolean,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "rooms.assign");

  await prisma.moodleCourse.update({
    where: { id: courseDbId },
    data: { reindexEnabled: enabled },
  });
  revalidatePath("/rooms");
}
