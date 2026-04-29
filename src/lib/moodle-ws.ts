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
