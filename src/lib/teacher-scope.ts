/**
 * Résolution du scope d'un Enseignant : "ses cours" et "ses agents".
 *
 *  - Ses agents = ceux qu'il a créés (`Agent.createdById = user.id`)
 *  - Ses cours = ceux où il est `editingteacher` côté Moodle, résolu via WS
 *    par son email Keycloak. Résultat caché 1h dans User.moodleUserMap +
 *    User.lastMoodleSyncAt.
 *
 * Les helpers `*WhereFor(role, ...)` retournent des clauses Prisma à
 * combiner dans les findMany/count des pages. Ils centralisent la logique
 * pour éviter qu'elle se duplique dans /agents, /rooms, /dashboard.
 */
import { prisma } from "@/lib/prisma";
import {
  getEnrolledUsers,
  getUserByEmail,
  getUserEnrolledCourses,
} from "@/lib/moodle-ws";
import { logger } from "@/lib/logger";
import type { Prisma, UserRole } from "@prisma/client";

const log = logger.child({ mod: "teacher-scope" });

// TTL du cache moodleUserMap / cours résolus. 1h = bon compromis :
// l'enrôlement Moodle change peu, et un re-resolve est rapide (~2 WS calls).
const RESOLVE_TTL_MS = 60 * 60 * 1000;

// Rôles Moodle considérés comme "enseignant". editingteacher est le rôle
// principal ; on accepte aussi teacher (non-editing) au cas où. Pas "manager"
// car le manager Moodle est un admin, hors scope pédagogique.
const TEACHER_ROLE_SHORTNAMES = new Set(["editingteacher", "teacher"]);

/**
 * Résout l'ensemble des MoodleCourse.id (CUIDs de notre DB) où l'utilisateur
 * est enseignant. Cache en DB pour 1h.
 *
 * Retourne `[]` si :
 *  - l'utilisateur n'est inscrit nulle part comme prof
 *  - aucune plateforme Moodle activée n'a son email
 *
 * Throw uniquement si la DB est down.
 */
export async function resolveTeacherCourseIds(
  userId: string,
): Promise<string[]> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      email: true,
      moodleUserMap: true,
      lastMoodleSyncAt: true,
    },
  });

  const platforms = await prisma.moodlePlatform.findMany({
    where: { enabled: true },
  });

  // Sync depuis Moodle si le cache est obsolète
  const fresh =
    user.lastMoodleSyncAt &&
    Date.now() - user.lastMoodleSyncAt.getTime() < RESOLVE_TTL_MS;

  if (!fresh) {
    await syncTeacherFromMoodle(userId, user.email, platforms);
  }

  // Re-fetch pour avoir le map à jour (post-sync)
  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { moodleUserMap: true },
  });
  const map = (updated.moodleUserMap ?? {}) as Record<string, number[]>;

  // map = { [platformId]: [moodleCourseId_1, moodleCourseId_2, ...] }
  // On résout en MoodleCourse.id (CUIDs de notre DB)
  const dbCourseIds: string[] = [];
  for (const [platformId, moodleCourseIds] of Object.entries(map)) {
    if (!Array.isArray(moodleCourseIds) || moodleCourseIds.length === 0) continue;
    const courses = await prisma.moodleCourse.findMany({
      where: { platformId, moodleId: { in: moodleCourseIds } },
      select: { id: true },
    });
    dbCourseIds.push(...courses.map((c) => c.id));
  }
  return dbCourseIds;
}

async function syncTeacherFromMoodle(
  userId: string,
  email: string,
  platforms: Array<{ id: string; key: string; baseUrl: string; wsToken: string }>,
): Promise<void> {
  const map: Record<string, number[]> = {};

  for (const platform of platforms) {
    try {
      const mu = await getUserByEmail(platform, email);
      if (!mu) continue;

      const enrolled = await getUserEnrolledCourses(platform, mu.id);
      // Filtre par rôle d'enseignant — `core_enrol_get_users_courses` ne
      // retourne pas le rôle, on requête `core_enrol_get_enrolled_users`
      // pour chaque cours pour vérifier. C'est N requêtes ; on cache 1h
      // donc acceptable, mais pour 100+ cours ça pourrait être lent.
      const teacherCourseIds: number[] = [];
      for (const course of enrolled) {
        const users = await getEnrolledUsers(platform, course.id);
        const me = users.find((u) => u.id === mu.id);
        const roles = me?.roles ?? [];
        if (roles.some((r) => TEACHER_ROLE_SHORTNAMES.has(r.shortname))) {
          teacherCourseIds.push(course.id);
        }
      }

      map[platform.id] = teacherCourseIds;
      log.info(
        {
          userId,
          platform: platform.key,
          moodleUserId: mu.id,
          teacherCourses: teacherCourseIds.length,
        },
        "Teacher Moodle scope résolu",
      );
    } catch (e) {
      log.warn(
        { userId, platform: platform.key, err: e instanceof Error ? e.message : e },
        "Échec résolution scope sur cette plateforme — skip",
      );
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      moodleUserMap: map as Prisma.InputJsonValue,
      lastMoodleSyncAt: new Date(),
    },
  });
}

// ── Helpers de scoping Prisma ──────────────────────────────────────────────

/**
 * Clause where pour Agent selon le rôle. ENSEIGNANT ne voit que les agents
 * qu'il a créés. ADMIN/MANAGER voient tout.
 */
export function agentWhereFor(
  role: UserRole,
  userId: string,
): Prisma.AgentWhereInput {
  if (role === "ENSEIGNANT") return { createdById: userId };
  return {};
}

/**
 * Clause where pour Room selon le rôle + (pour ENSEIGNANT) liste de
 * courseIds résolus à l'avance via resolveTeacherCourseIds.
 */
export function roomWhereForTeacher(
  role: UserRole,
  teacherCourseIds: string[] | null,
): Prisma.RoomWhereInput {
  if (role === "ADMIN") return {};
  if (role === "ENSEIGNANT") {
    if (!teacherCourseIds || teacherCourseIds.length === 0) {
      // Aucun cours résolu → aucune room visible (sécurise contre un fail
      // silencieux qui afficherait tout)
      return { id: { in: [] } };
    }
    return {
      source: "MOODLE",
      moodleCourseId: { in: teacherCourseIds },
    };
  }
  // MANAGER / AUDITOR : tous les salons Moodle
  return { source: "MOODLE" };
}

/**
 * Clause where pour MoodleCourse selon le rôle + courseIds résolus.
 */
export function courseWhereForTeacher(
  role: UserRole,
  teacherCourseIds: string[] | null,
): Prisma.MoodleCourseWhereInput {
  if (role === "ENSEIGNANT") {
    if (!teacherCourseIds || teacherCourseIds.length === 0) {
      return { id: { in: [] } };
    }
    return { id: { in: teacherCourseIds } };
  }
  return {};
}
