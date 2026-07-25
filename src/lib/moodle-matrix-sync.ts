/**
 * Cœur de la sync des activités mod_matrix pour une plateforme donnée.
 *
 * Extrait du server action `syncMatrixActivitiesForPlatform` pour être
 * réutilisable sans permission-check depuis d'autres server actions qui
 * ont déjà vérifié l'auth en amont (ex. `refreshMyCoursesFromMoodle` sur
 * /mes-cours, appelé par un ENSEIGNANT qui n'a pas `rooms.assign`).
 *
 * Ce fichier n'a PAS `"use server"` : c'est une lib pure, donc elle
 * n'est jamais exposée en tant que server action RPC. Le contrôle
 * d'accès reste chez les server actions publiques (moodle/actions.ts
 * pour l'admin, mes-cours/actions.ts pour l'ENSEIGNANT/MANAGER).
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { listMatrixActivities } from "@/lib/moodle-ws";
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "moodle-matrix-sync" });

export type SyncMatrixActivitiesResult = {
  total: number;
  inserted: number;
  updated: number;
  removed: number;
  linkedRooms: number;
  linkedByName: number;
};

export async function syncMatrixActivitiesForPlatformCore(
  platformId: string,
): Promise<SyncMatrixActivitiesResult> {
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
  let linkedRooms = 0;
  let linkedByName = 0;
  for (const a of activities) {
    const moodleCourse = await prisma.moodleCourse.findUnique({
      where: {
        platformId_moodleId: { platformId, moodleId: a.course },
      },
      select: { id: true },
    });
    if (!moodleCourse) continue;

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
