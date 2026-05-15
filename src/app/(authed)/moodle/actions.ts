"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { encrypt } from "@/lib/crypto";
import {
  getCourseContents,
  listCourses,
  listMatrixActivities,
} from "@/lib/moodle-ws";
import {
  embedCourseChunks,
  extractCourseContents,
} from "@/lib/rag-indexer";
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

  const platform = await prisma.moodlePlatform.findUniqueOrThrow({
    where: { id: platformId },
  });

  // On peut filtrer par courseIds des cours déjà sync'es — mais sans filtre,
  // mod_matrix_get_matrices_by_courses retourne []. Donc on passe tous les ids.
  const courses = await prisma.moodleCourse.findMany({
    where: { platformId },
    select: { moodleId: true },
  });
  const courseIds = courses.map((c) => c.moodleId);

  if (courseIds.length === 0) {
    throw new Error(
      "Aucun cours synchronisé — lance d'abord la synchronisation des cours.",
    );
  }

  const activities = await listMatrixActivities(platform, courseIds);

  // Upsert chaque activité ; collecte les moodleId encore présents
  let inserted = 0;
  let updated = 0;
  const seenMoodleIds: number[] = [];

  for (const a of activities) {
    seenMoodleIds.push(a.id);
    const existing = await prisma.moodleMatrixActivity.findUnique({
      where: { platformId_moodleId: { platformId, moodleId: a.id } },
    });
    const data = {
      courseModuleId: a.coursemodule,
      moodleCourseId: a.course,
      courseShortname: a.course_shortname,
      courseFullname: a.course_fullname,
      name: a.name,
      topic: a.topic ?? null,
      target: a.target ?? null,
      section: a.section ?? null,
      rooms: a.rooms,
      timecreated: new Date(a.timecreated * 1000),
      timemodified: a.timemodified
        ? new Date(a.timemodified * 1000)
        : null,
      lastSyncedAt: new Date(),
    };
    if (existing) {
      await prisma.moodleMatrixActivity.update({
        where: { id: existing.id },
        data,
      });
      updated++;
    } else {
      await prisma.moodleMatrixActivity.create({
        data: { platformId, moodleId: a.id, ...data },
      });
      inserted++;
    }
  }

  // Purge des activités qui ont disparu côté Moodle (suppressions)
  const { count: removed } = await prisma.moodleMatrixActivity.deleteMany({
    where: {
      platformId,
      ...(seenMoodleIds.length
        ? { moodleId: { notIn: seenMoodleIds } }
        : {}),
    },
  });

  // Auto-link Room ↔ MoodleCourse + flag source=MOODLE. Deux passes :
  //
  //  1. **Lien direct** par matrix_room_id : le mode normal du plugin (target=
  //     matrix-room) renvoie le room ID dans `rooms[].matrix_room_id`.
  //
  //  2. **Lien fuzzy** par nom : en mode `target=element-url`, le plugin crée
  //     bien le salon Synapse (creator=@admin) mais ne stocke pas son ID dans
  //     la table mod_matrix → matrix_room_id reste vide. Fallback : on
  //     cherche un Room dont le nom contient l'activity.name (pattern observé :
  //     `<course> (<activity>)` ou `<course> - <activity>`). Match unique →
  //     on lie, sinon on skip pour rester conservateur.
  //
  // Les rooms qui ne matchent ni l'un ni l'autre restent source=MATRIX
  // (= créées nativement via formation1-chat.unchk.sn, Element, etc.).
  let linkedRooms = 0;
  let linkedByName = 0;
  for (const a of activities) {
    const moodleCourse = await prisma.moodleCourse.findUnique({
      where: {
        platformId_moodleId: { platformId, moodleId: a.course },
      },
      select: { id: true },
    });
    if (!moodleCourse) continue; // cours pas encore sync, skip

    const roomEntries = (a.rooms ?? []) as Array<{
      matrix_room_id?: string;
    }>;

    // Pass 1 — lien direct par matrix_room_id
    let directlyLinked = false;
    for (const r of roomEntries) {
      const mxId = r.matrix_room_id;
      if (!mxId) continue;

      const u = await prisma.room.updateMany({
        where: { matrixRoomId: mxId },
        data: { source: "MOODLE", moodleCourseId: moodleCourse.id },
      });
      if (u.count > 0) {
        linkedRooms++;
        directlyLinked = true;
      }
    }
    if (directlyLinked) continue;

    // Pass 2 — fallback par nom (mode element-url)
    const candidates = await prisma.room.findMany({
      where: {
        name: { contains: a.name },
        source: { not: "MOODLE" },
      },
      select: { id: true },
    });
    if (candidates.length === 1) {
      await prisma.room.update({
        where: { id: candidates[0].id },
        data: { source: "MOODLE", moodleCourseId: moodleCourse.id },
      });
      linkedByName++;
    } else if (candidates.length > 1) {
      log.warn(
        {
          activity: a.name,
          candidates: candidates.length,
          courseShortname: a.course_shortname,
        },
        "Lien fuzzy ambigu — plusieurs salons matchent, skip",
      );
    }
  }

  log.info(
    {
      platform: platform.key,
      total: activities.length,
      inserted,
      updated,
      removed,
      linkedRooms,
      linkedByName,
    },
    "Sync mod_matrix activities",
  );
  revalidatePath("/moodle");
  revalidatePath(`/moodle/${platformId}/activities`);
  revalidatePath("/rooms");
  return {
    total: activities.length,
    inserted,
    updated,
    removed,
    linkedRooms,
    linkedByName,
  };
}

// ─── RAG Phase 11 — sync structurel (sections + resources) ──────────────────
//
// Modules indexables par le RAG. On ne synchronise QUE ces types, les autres
// (forum, quiz, assign, lesson…) sont ignorés à ce stade. À étendre plus tard
// quand on aura un parseur pour le forum.
const INDEXABLE_MODNAMES = new Set([
  "resource", // fichier upload (PDF/DOCX/PPT/...)
  "page", // page HTML interne
  "book", // livre en chapitres
  "label", // étiquette HTML inline
  "folder", // dossier de fichiers
]);

/**
 * Sync la structure pédagogique (sections + resources) d'un cours Moodle vers
 * MoodleSection + MoodleResource. Idempotent : upsert par moodle_id, purge
 * des entités disparues côté Moodle.
 *
 * Ne fait PAS encore l'extraction texte ni les embeddings (Phase 11d/e). Il
 * stocke juste la métadonnée + le HTML brut (description, summary) pour qu'on
 * puisse l'extraire ensuite hors-ligne.
 */
export async function syncCourseContents(courseDbId: string): Promise<{
  sections: number;
  resources: number;
  resourcesByType: Record<string, number>;
  removedSections: number;
  removedResources: number;
}> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "rooms.assign");

  const course = await prisma.moodleCourse.findUniqueOrThrow({
    where: { id: courseDbId },
    include: { platform: true },
  });

  const sections = await getCourseContents(course.platform, course.moodleId);

  let totalResources = 0;
  const byType: Record<string, number> = {};
  const seenSectionIds: number[] = [];
  const seenCmids: number[] = [];

  for (const s of sections) {
    seenSectionIds.push(s.id);

    // Upsert section
    const dbSection = await prisma.moodleSection.upsert({
      where: { courseId_moodleId: { courseId: course.id, moodleId: s.id } },
      create: {
        platformId: course.platformId,
        courseId: course.id,
        moodleId: s.id,
        name: s.name,
        summary: s.summary || null,
        sectionnum: s.section,
      },
      update: {
        name: s.name,
        summary: s.summary || null,
        sectionnum: s.section,
        // On reset l'extraction si le summary a changé. Phase 11d le verra et
        // re-fera l'extraction texte. Pour l'instant on remet juste à null.
        extractedText: null,
        textExtractedAt: null,
        embeddedAt: null,
        lastSyncedAt: new Date(),
      },
    });

    // Modules dans cette section
    for (const m of s.modules || []) {
      if (!INDEXABLE_MODNAMES.has(m.modname)) continue;

      seenCmids.push(m.id);
      byType[m.modname] = (byType[m.modname] ?? 0) + 1;
      totalResources++;

      // Pour resource/folder : on prend le premier fichier (resource n'a qu'un
      // fichier, folder peut en avoir plusieurs — on stocke quand même le 1er,
      // les autres seront indexés en Phase 11d via getCourseContents).
      const file = m.contents?.find((c) => c.type === "file");

      await prisma.moodleResource.upsert({
        where: { platformId_cmid: { platformId: course.platformId, cmid: m.id } },
        create: {
          platformId: course.platformId,
          courseId: course.id,
          sectionId: dbSection.id,
          cmid: m.id,
          modname: m.modname,
          name: m.name,
          url: m.url || null,
          description: m.description || null,
          filename: file?.filename || null,
          mimetype: file?.mimetype || null,
          filesize: file?.filesize || null,
          fileurl: file?.fileurl || null,
        },
        update: {
          sectionId: dbSection.id,
          modname: m.modname,
          name: m.name,
          url: m.url || null,
          description: m.description || null,
          filename: file?.filename || null,
          mimetype: file?.mimetype || null,
          filesize: file?.filesize || null,
          fileurl: file?.fileurl || null,
          // Reset l'extraction si fileurl change (nouveau fichier ou même
          // module mais contenu modifié — on hashe au download)
          extractedText: null,
          textExtractedAt: null,
          embeddedAt: null,
          syncError: null,
          lastSyncedAt: new Date(),
        },
      });
    }
  }

  // Purge — sections / resources qui ont disparu côté Moodle (cascade chunks)
  const { count: removedResources } = await prisma.moodleResource.deleteMany({
    where: {
      courseId: course.id,
      ...(seenCmids.length ? { cmid: { notIn: seenCmids } } : {}),
    },
  });
  const { count: removedSections } = await prisma.moodleSection.deleteMany({
    where: {
      courseId: course.id,
      ...(seenSectionIds.length
        ? { moodleId: { notIn: seenSectionIds } }
        : {}),
    },
  });

  log.info(
    {
      course: course.shortname,
      sections: sections.length,
      resources: totalResources,
      byType,
      removedSections,
      removedResources,
    },
    "Sync course contents",
  );
  revalidatePath("/moodle");
  revalidatePath(`/rooms`);

  return {
    sections: sections.length,
    resources: totalResources,
    resourcesByType: byType,
    removedSections,
    removedResources,
  };
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
 * Pipeline complet d'indexation RAG d'un cours Moodle :
 *   1. sync structurel (sections + resources via core_course_get_contents)
 *   2. extraction texte + chunking (PDFs, pages, labels)
 *   3. embeddings via fromager (nomic-embed-text 768-dim)
 *
 * Idempotent : peut être relancé. Active automatiquement reindexEnabled
 * (signal d'opt-in du cours).
 */
export async function fullReindexCourse(courseDbId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "rooms.assign");

  // 1. Sync structurel
  const sync = await syncCourseContents(courseDbId);

  // 2. Extraction + chunking
  const extract = await extractCourseContents(courseDbId);

  // 3. Embeddings (peut être long si gros cours — pas de timeout côté Next,
  // mais le client UI verra un spinner pendant tout le process)
  const embed = await embedCourseChunks(courseDbId);

  // 4. Active reindexEnabled (opt-in implicite)
  await prisma.moodleCourse.update({
    where: { id: courseDbId },
    data: { reindexEnabled: true },
  });

  log.info(
    { courseDbId, sync, extract, embed },
    "Full reindex pipeline OK",
  );
  revalidatePath("/moodle");
  revalidatePath("/rooms");
  return { sync, extract, embed };
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
