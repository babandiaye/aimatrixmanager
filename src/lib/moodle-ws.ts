import type { MoodlePlatform } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "moodle-ws" });

export class MoodleWSError extends Error {
  constructor(
    public errcode: string,
    message: string,
  ) {
    super(message);
  }
}

/** Appelle une fonction Moodle Web Services. */
export async function callMoodleWS<T = unknown>(
  platform: Pick<MoodlePlatform, "baseUrl" | "wsToken">,
  fn: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL("/webservice/rest/server.php", platform.baseUrl);
  url.searchParams.set("wstoken", decrypt(platform.wsToken));
  url.searchParams.set("wsfunction", fn);
  url.searchParams.set("moodlewsrestformat", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${fn}`);
  const json = await res.json();
  if (json && typeof json === "object" && "exception" in json) {
    const errcode = (json as { errorcode: string }).errorcode;
    const message = (json as { message: string }).message;
    log.warn({ fn, errcode, message }, "Moodle WS error");
    throw new MoodleWSError(errcode, message);
  }
  return json as T;
}

export type MoodleCourseDTO = {
  id: number;
  shortname: string;
  fullname: string;
  visible: number;
  categoryid: number;
};

export async function listCourses(
  platform: Pick<MoodlePlatform, "baseUrl" | "wsToken">,
): Promise<MoodleCourseDTO[]> {
  const r = await callMoodleWS<{ courses: MoodleCourseDTO[] }>(
    platform,
    "core_course_get_courses_by_field",
  );
  return r.courses;
}

// ── Contenu d'un cours (sections + modules) ─────────────────────────────────
// core_course_get_contents retourne la structure complète du cours. Pour les
// modules de type `resource`/`folder`, le champ `contents[]` liste les fichiers
// avec leurs URL WS et `contenthash` (SHA1 → clé de dédup). Pour `page`/`book`,
// le contenu réel passe par des WS dédiées (mod_page_*, mod_book_*).

export type MoodleFileDTO = {
  type: string; // "file" | "url"
  filename: string;
  filesize: number;
  fileurl: string; // URL WS, à compléter avec ?token=...
  mimetype?: string;
  timecreated?: number;
  timemodified?: number;
  contenthash?: string; // SHA1 — pour dédup
};

export type MoodleModuleDTO = {
  id: number; // cmid (course module id)
  name: string;
  modname: string; // "resource", "page", "book", "label", "folder", "forum", ...
  modplural?: string;
  url?: string; // URL UI Moodle
  description?: string; // HTML — contient le texte pour `label`, l'intro pour les autres
  descriptionformat?: number;
  contents?: MoodleFileDTO[]; // fichiers (resource, folder)
  visible?: number;
  uservisible?: boolean;
};

export type MoodleSectionDTO = {
  id: number;
  name: string;
  visible: number;
  summary?: string; // HTML
  summaryformat?: number;
  section: number; // ordre
  uservisible?: boolean;
  modules: MoodleModuleDTO[];
};

export async function getCourseContents(
  platform: Pick<MoodlePlatform, "baseUrl" | "wsToken">,
  courseId: number,
): Promise<MoodleSectionDTO[]> {
  return callMoodleWS<MoodleSectionDTO[]>(
    platform,
    "core_course_get_contents",
    { courseid: String(courseId) },
  );
}

// ── Résolution d'un utilisateur Moodle par son email ─────────────────────────
// Pour le rôle ENSEIGNANT : on a l'email Keycloak, on doit retrouver le
// userid Moodle pour ensuite lister ses cours.

export type MoodleUserDTO = {
  id: number;
  username: string;
  firstname: string;
  lastname: string;
  email: string;
};

export async function getUserByEmail(
  platform: Pick<MoodlePlatform, "baseUrl" | "wsToken">,
  email: string,
): Promise<MoodleUserDTO | null> {
  const r = await callMoodleWS<MoodleUserDTO[]>(
    platform,
    "core_user_get_users_by_field",
    { field: "email", "values[0]": email },
  );
  return r?.[0] ?? null;
}

// ── Liste des cours enrolés d'un user, avec son rôle dans chacun ─────────────
// `core_enrol_get_users_courses` retourne juste l'enrôlement (sans le rôle).
// Pour identifier les cours où il est *enseignant*, on doit ensuite filtrer.
// Stratégie : on retourne tous les cours enrolés. Le filtrage "rôle prof"
// se fait dans teacher-scope via une query supplémentaire si nécessaire.

export type MoodleEnrolledCourseDTO = {
  id: number;
  shortname: string;
  fullname: string;
  visible: number;
  // Rôles de l'utilisateur dans ce cours, en string pipe-separated
  // ex: "editingteacher,manager". Disponible selon la version Moodle.
};

export async function getUserEnrolledCourses(
  platform: Pick<MoodlePlatform, "baseUrl" | "wsToken">,
  moodleUserId: number,
): Promise<MoodleEnrolledCourseDTO[]> {
  return callMoodleWS<MoodleEnrolledCourseDTO[]>(
    platform,
    "core_enrol_get_users_courses",
    { userid: String(moodleUserId) },
  );
}

// ── Liste des participants d'un cours avec leurs rôles ──────────────────────
// `core_enrol_get_enrolled_users` retourne {id, roles, ...}. roles est un
// array `[{roleid, name, shortname}]`. On l'utilise pour vérifier qu'un user
// est bien "editingteacher" (et pas juste "student") dans un cours.

export type MoodleEnrolledUserDTO = {
  id: number;
  email?: string;
  roles?: Array<{ roleid: number; name: string; shortname: string }>;
};

export async function getEnrolledUsers(
  platform: Pick<MoodlePlatform, "baseUrl" | "wsToken">,
  courseId: number,
): Promise<MoodleEnrolledUserDTO[]> {
  return callMoodleWS<MoodleEnrolledUserDTO[]>(
    platform,
    "core_enrol_get_enrolled_users",
    { courseid: String(courseId) },
  );
}

export type MoodleMatrixRoomDTO = {
  matrix_room_id: string;
  group_id: number | null;
  timecreated: number;
};

export type MoodleMatrixActivityDTO = {
  id: number;
  coursemodule: number;
  course: number;
  course_shortname: string;
  course_fullname: string;
  name: string;
  topic: string | null;
  target: string | null;
  section: number | null;
  timecreated: number;
  timemodified: number;
  rooms: MoodleMatrixRoomDTO[];
};

/**
 * Liste les activités du plugin mod_matrix (Famedly) sur la plateforme.
 * Si `courseIds` est fourni, restreint à ces cours — sinon retourne tous
 * les cours visibles par le token (en pratique, scope du compte service).
 */
export async function listMatrixActivities(
  platform: Pick<MoodlePlatform, "baseUrl" | "wsToken">,
  courseIds?: number[],
): Promise<MoodleMatrixActivityDTO[]> {
  const params: Record<string, string> = {};
  if (courseIds?.length) {
    courseIds.forEach((id, i) => {
      params[`courseids[${i}]`] = String(id);
    });
  }
  const r = await callMoodleWS<{
    matrices: MoodleMatrixActivityDTO[];
    warnings: unknown[];
  }>(platform, "mod_matrix_get_matrices_by_courses", params);
  return r.matrices;
}
