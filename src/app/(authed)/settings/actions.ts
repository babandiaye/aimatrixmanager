"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { SETTINGS_ID } from "@/lib/auth-config";

export async function setKeycloakEnabled(enabled: boolean) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "settings.manage");

  await prisma.systemSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { keycloakEnabled: enabled, updatedById: session.user.id },
    create: {
      id: SETTINGS_ID,
      keycloakEnabled: enabled,
      updatedById: session.user.id,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/login");
}
