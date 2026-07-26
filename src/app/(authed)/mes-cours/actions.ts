"use server";

import { auth } from "@/auth";
import { canAny } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { syncMatrixActivitiesForPlatformCore } from "@/lib/moodle-matrix-sync";
import { getRoomStateSummary, listAllRooms } from "@/lib/synapse-admin";
import { refreshTeacherScope } from "@/lib/teacher-scope";
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
  /** Plateformes où le compte Moodle de l'utilisateur n'a pas pu être résolu. */
  unresolvedPlatforms: string[];
  errors: string[];
}> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  // Portée UI : ADMIN/MANAGER/ENSEIGNANT peuvent rafraîchir. AUDITOR
  // (read-only) est exclu — pas de raison de laisser un rôle purement
  // consultation déclencher des WS calls vers Moodle. Le bouton est
  // aussi caché côté page pour ce rôle.
  if (session.user.role === "AUDITOR") {
    throw new Error("Permission refusée");
  }
  if (!canAny(session.user.role, "rooms.view", "rooms.view-own")) {
    throw new Error("Permission refusée");
  }

  const errors: string[] = [];

  // 1. Re-résout le scope teacher immédiatement (au lieu de simplement
  //    invalider le cache et laisser le prochain rendu le refaire). Ça
  //    permet de récupérer la liste des plateformes où le compte Moodle
  //    n'a pas pu être résolu et de la remonter à l'utilisateur — sinon
  //    l'échec est totalement silencieux et il voit juste moins de cours.
  let unresolvedPlatforms: string[] = [];
  try {
    unresolvedPlatforms = await refreshTeacherScope(session.user.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Résolution du scope enseignant : ${msg}`);
    log.warn({ err: msg }, "refreshMyCoursesFromMoodle : refreshTeacherScope échoué");
  }

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

      // Même logique que syncRoomsFromSynapse : on lit m.room.create pour
      // détecter les salons Moodle (org.matrix.moodle.course_id) et on
      // utilise le vrai flag is_direct des member events plutôt que
      // l'ancien heuristique joined_members <= 2.
      let stateSummary: Awaited<ReturnType<typeof getRoomStateSummary>>;
      try {
        stateSummary = await getRoomStateSummary(r.room_id);
      } catch (e) {
        log.warn(
          { err: e, roomId: r.room_id },
          "getRoomStateSummary échoué — fallback neutre",
        );
        stateSummary = { moodleCourseId: null, isDirect: false };
      }

      let moodleCourseIdDb: string | null = null;
      if (stateSummary.moodleCourseId !== null) {
        const candidates = await prisma.moodleCourse.findMany({
          where: { moodleId: stateSummary.moodleCourseId },
          select: { id: true },
        });
        if (candidates.length === 1) moodleCourseIdDb = candidates[0].id;
      }

      const baseData = {
        name: r.name,
        isDirect: stateSummary.isDirect,
        isEncrypted: !!r.encryption,
      };
      const moodleData: {
        source?: "MOODLE";
        moodleCourseId?: string;
      } = {};
      if (stateSummary.moodleCourseId !== null) {
        moodleData.source = "MOODLE";
        if (moodleCourseIdDb !== null) {
          moodleData.moodleCourseId = moodleCourseIdDb;
        }
      }

      if (existing) {
        await prisma.room.update({
          where: { id: existing.id },
          data: { ...baseData, ...moodleData },
        });
        roomsUpdated++;
      } else {
        await prisma.room.create({
          data: { matrixRoomId: r.room_id, ...baseData, ...moodleData },
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
      // On appelle le core (pas de vérif `rooms.assign`) : l'auth du user
      // et sa permission `rooms.view*` a déjà été vérifiée ligne 46. Un
      // ENSEIGNANT peut donc rafraîchir ses cours sans notif "permission
      // refusée" pour chaque plateforme comme avant.
      const r = await syncMatrixActivitiesForPlatformCore(p.id);
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
    unresolvedPlatforms,
    errors,
  };
}
