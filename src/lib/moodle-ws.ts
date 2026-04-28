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
