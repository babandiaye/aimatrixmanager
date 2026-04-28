"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";

export async function deleteAuditLog(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "audit.delete");

  await prisma.auditLog.delete({ where: { id } });
  revalidatePath("/audit");
  redirect("/audit");
}
