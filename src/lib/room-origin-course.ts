/**
 * Résout le "cours d'origine" d'un salon Matrix : le seul cours Moodle
 * dont le salon est légitimement issu via le plugin mod_matrix.
 *
 * Utilisé par /rooms/[id] pour n'offrir qu'un choix binaire dans le
 * sélecteur de cours — « aucun » + le cours porteur de l'activité. Un
 * salon issu de l'activité `mod/matrix/view.php?id=247` du cours
 * `course/view.php?id=50` sur DISIDEV ne doit jamais proposer un autre
 * cours, fût-il indexable.
 *
 * Quatre sources, par ordre décroissant de fiabilité :
 *
 *  1. **linked**          — `Room.moodleCourseId` déjà posé (sync ou
 *     correction manuelle d'un admin). On le respecte en priorité.
 *
 *  2. **activity-room**   — `MoodleMatrixActivity.rooms[].matrix_room_id`.
 *     Le chemin le plus direct, mais inopérant en mode `target=element-url`
 *     où le plugin laisse ce champ vide.
 *
 *  3. **activity-marker** — marqueurs `org.matrix.moodle.course_id` (+
 *     `group_id`) du `m.room.create`, croisés avec la table des activités.
 *     C'est elle qui porte le `platformId`, ce qui lève la collision de
 *     `moodleId` entre plateformes (cas réel : `moodleId=50` désigne
 *     « Integration Jokko Meet » sur DISIDEV **et** « UN-AGN/INFO » sur
 *     P13STN ; une seule des deux a une activité mod_matrix sur ce cours).
 *
 *  4. **marker**          — dernier recours : `MoodleCourse.moodleId` seul.
 *     N'aboutit que si un unique cours porte cet id toutes plateformes
 *     confondues.
 *
 * `hasMoodleMarker` distingue « salon Moodle dont on n'a pas su résoudre
 * le cours » (→ n'offrir que « aucun ») de « salon natif Element »
 * (→ laisser l'admin choisir librement).
 */
import { prisma } from "@/lib/prisma";
import { getRoomStateSummary } from "@/lib/synapse-admin";
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "room-origin-course" });

export type OriginCourseSource =
  | "linked"
  | "activity-room"
  | "activity-marker"
  | "marker";

export type OriginCourse = {
  courseId: string;
  platformId: string;
  source: OriginCourseSource;
};

export type RoomOrigin = {
  /** Le salon porte un marqueur mod_matrix, ou est déjà lié à un cours. */
  hasMoodleMarker: boolean;
  /** Cours d'origine, ou `null` si indéterminable. */
  course: OriginCourse | null;
};

export async function resolveOriginCourse(
  matrixRoomId: string,
  currentMoodleCourseId: string | null,
): Promise<RoomOrigin> {
  // ─── 1. linked ─────────────────────────────────────────────────────
  if (currentMoodleCourseId) {
    const c = await prisma.moodleCourse.findUnique({
      where: { id: currentMoodleCourseId },
      select: { id: true, platformId: true },
    });
    if (c) {
      return {
        hasMoodleMarker: true,
        course: { courseId: c.id, platformId: c.platformId, source: "linked" },
      };
    }
  }

  // ─── 2. activity-room ──────────────────────────────────────────────
  // Prisma n'exprime pas l'opérateur jsonb `@>` → SQL brut. LIMIT 2 pour
  // détecter une éventuelle anomalie sans ramener toute la table.
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
      const c = await findCourse(rows[0].platformId, rows[0].moodleCourseId);
      if (c) return { hasMoodleMarker: true, course: { ...c, source: "activity-room" } };
    } else if (rows.length > 1) {
      log.warn(
        { matrixRoomId, matches: rows.length },
        "Plusieurs activités revendiquent ce matrix_room_id — source ignorée",
      );
    }
  } catch (e) {
    log.warn({ err: e, matrixRoomId }, "Requête jsonb activités échouée — source ignorée");
  }

  // ─── Marqueurs Matrix (nécessaires aux sources 3 et 4) ─────────────
  let marker: { courseId: number; groupId: number | null } | null = null;
  try {
    const s = await getRoomStateSummary(matrixRoomId);
    if (s.moodleCourseId !== null) {
      marker = { courseId: s.moodleCourseId, groupId: s.moodleGroupId };
    }
  } catch (e) {
    log.warn({ err: e, matrixRoomId }, "Lecture du state Matrix échouée");
  }
  if (!marker) return { hasMoodleMarker: false, course: null };

  // ─── 3 & 4 : résolution depuis les marqueurs ──────────────────────
  const fromMarkers = await resolveCourseFromMarkers(
    marker.courseId,
    marker.groupId,
    matrixRoomId,
  );

  // Marqueur présent mais cours introuvable : l'appelant ne doit PAS
  // retomber sur « tous les cours indexables ».
  return { hasMoodleMarker: true, course: fromMarkers };
}

/**
 * Résout un cours à partir des seuls marqueurs `m.room.create`, sans
 * relire l'état Matrix. Exposé pour `syncRoomsFromSynapse`, qui a déjà
 * les marqueurs en main et éviterait sinon un second appel `/state` par
 * salon (× 60 salons à chaque sync).
 *
 * Deux passes :
 *  - **activity-marker** — croisement avec `MoodleMatrixActivity`, seule
 *    table portant le `platformId`. Lève la collision de `moodleId`
 *    entre plateformes. Affine par `group_id` si plusieurs activités du
 *    même cours sont candidates.
 *  - **marker** — repli sur `MoodleCourse.moodleId` seul, valable
 *    uniquement s'il désigne un cours unique toutes plateformes
 *    confondues.
 */
export async function resolveCourseFromMarkers(
  markerCourseId: number,
  markerGroupId: number | null,
  matrixRoomId?: string,
): Promise<OriginCourse | null> {
  try {
    const candidates = await prisma.moodleMatrixActivity.findMany({
      where: { moodleCourseId: markerCourseId },
      select: { platformId: true, rooms: true },
    });

    let matching = candidates;
    if (markerGroupId !== null && candidates.length > 1) {
      const byGroup = candidates.filter((a) =>
        Array.isArray(a.rooms)
          ? (a.rooms as Array<{ group_id?: number }>).some(
              (r) => r?.group_id === markerGroupId,
            )
          : false,
      );
      if (byGroup.length > 0) matching = byGroup;
    }

    const platforms = new Set(matching.map((a) => a.platformId));
    if (platforms.size === 1) {
      const c = await findCourse([...platforms][0], markerCourseId);
      if (c) return { ...c, source: "activity-marker" };
    } else if (platforms.size > 1) {
      log.warn(
        { matrixRoomId, courseId: markerCourseId, platforms: platforms.size },
        "Activités mod_matrix sur plusieurs plateformes pour ce course_id",
      );
    }
  } catch (e) {
    log.warn({ err: e, matrixRoomId }, "Résolution via activités échouée");
  }

  const byMoodleId = await prisma.moodleCourse.findMany({
    where: { moodleId: markerCourseId },
    select: { id: true, platformId: true },
  });
  if (byMoodleId.length === 1) {
    return {
      courseId: byMoodleId[0].id,
      platformId: byMoodleId[0].platformId,
      source: "marker",
    };
  }
  if (byMoodleId.length > 1) {
    log.warn(
      { matrixRoomId, moodleId: markerCourseId, matches: byMoodleId.length },
      "moodleId ambigu entre plateformes et aucune activité pour trancher",
    );
  }
  return null;
}

async function findCourse(
  platformId: string,
  moodleId: number,
): Promise<{ courseId: string; platformId: string } | null> {
  const c = await prisma.moodleCourse.findFirst({
    where: { platformId, moodleId },
    select: { id: true, platformId: true },
  });
  return c ? { courseId: c.id, platformId: c.platformId } : null;
}
