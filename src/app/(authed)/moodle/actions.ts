"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { encrypt } from "@/lib/crypto";
import { listCourses } from "@/lib/moodle-ws";
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
