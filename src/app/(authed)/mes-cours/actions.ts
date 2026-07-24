"use server";

import { auth } from "@/auth";
import { canAny } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { syncMatrixActivitiesForPlatform } from "../moodle/actions";
import { listAllRooms } from "@/lib/synapse-admin";
import { revalidatePath } from "next/cache";

const log = logger.child({ mod: "mes-cours-actions" });

/**
 * Rafraîchit la vue « Mes cours » depuis Moodle.
 *
 * Fait DEUX choses, en parallèle :
 *
 *  1. Invalide le cache `User.lastMoodleSyncAt` de l'utilisateur courant.
 *     Au prochain `resolveTeacherCourseIds()`, le teacher-scope sera
 *     re-résolu depuis Moodle (2 WS calls par plateforme). Utile quand
 *     un cours a été ajouté / rôle d'enseignant modifié côté Moodle mais
 *     que le cache 1h de aibotmanager ne l'a pas encore rafraîchi.
 *
 *  2. Relance `syncMatrixActivitiesForPlatform` sur chaque plateforme
 *     activée. Ramène les nouvelles activités `mod_matrix` créées côté
 *     Moodle (et l'auto-link Room↔MoodleCourse). Nécessaire quand un
 *     enseignant vient de créer une activité et veut la voir apparaître
 *     dans son cours sans attendre le prochain sync manuel côté /moodle.
 *
 * Note perf : chaque plateforme = 1 WS call `mod_matrix_get_matrices_by_
 * courses`. Pour 3 plateformes ~500ms total. Acceptable en action user
 * synchrone.
 */
export async function refreshMyCoursesFromMoodle(): Promise<{
  platformsSynced: number;
  activitiesFound: number;
  roomsImported: number;
  roomsLinked: number;
  errors: string[];
}> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  // Même permission que /mes-cours pour rester cohérent (ENSEIGNANT ok,
  // AUDITOR non — pas de raison de laisser un rôle read-only déclencher
  // des WS calls vers Moodle).
  if (!canAny(session.user.role, "rooms.view", "rooms.view-own")) {
    throw new Error("Permission refusée");
  }

  // 1. Invalide le cache teacher-scope perso
  await prisma.user.update({
    where: { id: session.user.id },
    data: { lastMoodleSyncAt: null },
  });

  const errors: string[] = [];

  // 2. Importer les nouveaux salons depuis Synapse.
  //    Étape indispensable AVANT le sync des activités : le fuzzy match
  //    par nom (fallback quand mod_matrix ne renvoie pas de matrix_room_id
  //    en mode `element-url`) cherche des Room *déjà en DB*. Sans ce
  //    sync préalable, une activité mod_matrix récemment créée reste
  //    orpheline même si le salon existe côté Synapse.
  //
  //    Note : on inline la logique de syncRoomsFromSynapse au lieu de
  //    l'importer depuis rooms/actions.ts. L'appel inter-server-actions
  //    via import est parfois surprenant dans Next 16 (mêmes routes,
  //    contextes d'auth partagés) — inliner évite tout mauvais surprise
  //    et permet un logging fin.
  let roomsImported = 0;
  let roomsUpdated = 0;
  try {
    log.info("refreshMyCoursesFromMoodle : listAllRooms via Synapse admin");
    const synapseRooms = await listAllRooms();
    log.info(
      { count: synapseRooms.length },
      "refreshMyCoursesFromMoodle : rooms remontés par Synapse",
    );
    for (const r of synapseRooms) {
      const existing = await prisma.room.findUnique({
        where: { matrixRoomId: r.room_id },
      });
      const data = {
        name: r.name,
        isDirect: r.joined_members <= 2,
        isEncrypted: !!r.encryption,
      };
      if (existing) {
        await prisma.room.update({ where: { id: existing.id }, data });
        roomsUpdated++;
      } else {
        await prisma.room.create({
          data: { matrixRoomId: r.room_id, ...data },
        });
        roomsImported++;
      }
    }
    log.info(
      { inserted: roomsImported, updated: roomsUpdated },
      "refreshMyCoursesFromMoodle : sync Synapse rooms terminé",
    );
    revalidatePath("/rooms");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Sync salons Synapse : ${msg}`);
    log.warn(
      { err: msg, stack: e instanceof Error ? e.stack : undefined },
      "refreshMyCoursesFromMoodle : sync rooms Synapse échouée",
    );
  }

  // 3. Sync des activités matrix — sur toutes les plateformes activées.
  //    Effectue AUSSI l'auto-link Room ↔ MoodleCourse (passe 1 direct
  //    matrix_room_id, passe 2 fuzzy match par nom).
  //    On avale les erreurs par plateforme (une plateforme injoignable
  //    ne doit pas bloquer les autres).
  const platforms = await prisma.moodlePlatform.findMany({
    where: { enabled: true },
    select: { id: true, name: true },
  });

  let activitiesFound = 0;
  let roomsLinked = 0;
  for (const p of platforms) {
    try {
      const r = await syncMatrixActivitiesForPlatform(p.id);
      activitiesFound += r.total;
      roomsLinked += r.linkedRooms + r.linkedByName;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${p.name} : ${msg}`);
      log.warn(
        { platform: p.name, err: msg },
        "refreshMyCoursesFromMoodle : sync activités échouée sur plateforme",
      );
    }
  }

  return {
    platformsSynced: platforms.length - errors.length,
    activitiesFound,
    roomsImported,
    roomsLinked,
    errors,
  };
}
