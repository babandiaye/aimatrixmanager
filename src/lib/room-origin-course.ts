/**
 * Résout le "cours d'origine" d'un salon Matrix : le seul cours Moodle
 * dont le salon est légitimement issu via le plugin mod_matrix.
 *
 * Utilisé par la page /rooms/[id] pour restreindre le CourseLinker à un
 * choix binaire (aucun / cours d'origine) au lieu de lister tous les
 * cours indexables de la plateforme, qui laissait passer des cours sans
 * rapport (ex. « Test Plugin Jokko » dans le sélecteur d'un salon
 * appartenant à « Integration Jokko Meet »).
 *
 * Trois sources par ordre décroissant de fiabilité :
 *
 *  1. **linked**   — `Room.moodleCourseId` : le lien a déjà été posé
 *     par une sync précédente. C'est la vérité opérationnelle actuelle,
 *     on la respecte même si les autres sources disent autre chose (un
 *     admin peut avoir corrigé le lien à la main).
 *
 *  2. **activity** — `MoodleMatrixActivity.rooms` : le sync mod_matrix
 *     stocke le `matrix_room_id` dans le jsonb `rooms`. Naturellement
 *     scopée par `platformId` → pas d'ambiguïté multi-plateforme (deux
 *     Moodle différents peuvent avoir un course_id numérique identique).
 *
 *  3. **marker**   — `org.matrix.moodle.course_id` dans le
 *     `m.room.create` du salon. Résolu sur `MoodleCourse.moodleId`.
 *     Si plusieurs plateformes ont un cours avec le même moodleId,
 *     on renonce (log warn) — l'admin devra lier manuellement.
 *
 * Retourne `null` pour les salons sans origine Moodle (natifs Element,
 * salons E2EE créés manuellement, etc.).
 */
import { prisma } from "@/lib/prisma";
import { getRoomStateSummary } from "@/lib/synapse-admin";
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "room-origin-course" });

export type OriginCourseSource = "linked" | "activity" | "marker";

export type OriginCourse = {
  courseId: string;
  platformId: string;
  source: OriginCourseSource;
};

export async function resolveOriginCourse(
  matrixRoomId: string,
  currentMoodleCourseId: string | null,
): Promise<OriginCourse | null> {
  // ─── 1. Source « linked » ──────────────────────────────────────────
  if (currentMoodleCourseId) {
    const c = await prisma.moodleCourse.findUnique({
      where: { id: currentMoodleCourseId },
      select: { id: true, platformId: true },
    });
    if (c) {
      return { courseId: c.id, platformId: c.platformId, source: "linked" };
    }
  }

  // ─── 2. Source « activity » (MoodleMatrixActivity.rooms jsonb) ─────
  // Prisma ne sait pas exprimer l'opérateur `@>` sur Json → raw SQL.
  // La query renvoie 0/1/N candidats ; on ne lie que si N=1 pour rester
  // conservateur (deux activités mod_matrix distinctes ne devraient
  // jamais partager un même matrix_room_id, mais la protection ne coûte
  // rien). LIMIT 2 pour ne pas ramener toute la table en cas d'anomalie.
  try {
    const rows = await prisma.$queryRaw<
      Array<{ platformId: string; moodleCourseId: number }>
    >`
      SELECT DISTINCT a."platformId", a."moodleCourseId"
      FROM "MoodleMatrixActivity" a
      WHERE a.rooms @> ${JSON.stringify([{ matrix_room_id: matrixRoomId }])}::jsonb
      LIMIT 2
    `;
    if (rows.length === 1) {
      const c = await prisma.moodleCourse.findFirst({
        where: {
          platformId: rows[0].platformId,
          moodleId: rows[0].moodleCourseId,
        },
        select: { id: true, platformId: true },
      });
      if (c) {
        return { courseId: c.id, platformId: c.platformId, source: "activity" };
      }
    } else if (rows.length > 1) {
      log.warn(
        { matrixRoomId, matches: rows.length },
        "MoodleMatrixActivity match ambigu — skip source 'activity'",
      );
    }
  } catch (e) {
    log.warn(
      { err: e, matrixRoomId },
      "MoodleMatrixActivity jsonb query failed — skip source 'activity'",
    );
  }

  // ─── 3. Source « marker » (m.room.create custom field) ─────────────
  try {
    const summary = await getRoomStateSummary(matrixRoomId);
    if (summary.moodleCourseId !== null) {
      const candidates = await prisma.moodleCourse.findMany({
        where: { moodleId: summary.moodleCourseId },
        select: { id: true, platformId: true },
      });
      if (candidates.length === 1) {
        return {
          courseId: candidates[0].id,
          platformId: candidates[0].platformId,
          source: "marker",
        };
      } else if (candidates.length > 1) {
        log.warn(
          {
            matrixRoomId,
            moodleId: summary.moodleCourseId,
            matches: candidates.length,
          },
          "Marker Matrix ambigu multi-plateforme — skip source 'marker'",
        );
      }
    }
  } catch (e) {
    log.warn(
      { err: e, matrixRoomId },
      "getRoomStateSummary failed — skip source 'marker'",
    );
  }

  return null;
}
