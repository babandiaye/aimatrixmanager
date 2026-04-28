"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";

const roleSchema = z.enum(["ADMIN", "MANAGER", "AUDITOR"]);

async function countAdmins(): Promise<number> {
  return prisma.user.count({ where: { role: "ADMIN" } });
}

export async function updateUserRole(userId: string, role: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "users.manage");

  const parsed = roleSchema.safeParse(role);
  if (!parsed.success) throw new Error("Rôle invalide");

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!target) throw new Error("Utilisateur introuvable");

  // Empêche de se rétrograder soi-même (évite le lock-out involontaire)
  if (target.id === session.user.id && parsed.data !== "ADMIN") {
    throw new Error(
      "Tu ne peux pas changer ton propre rôle. Demande à un autre admin.",
    );
  }

  // Empêche de retirer le dernier ADMIN
  if (target.role === "ADMIN" && parsed.data !== "ADMIN") {
    if ((await countAdmins()) <= 1) {
      throw new Error("Impossible : c'est le dernier administrateur.");
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { role: parsed.data },
  });
  revalidatePath("/users");
}

export async function deleteUser(userId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "users.manage");

  if (userId === session.user.id) {
    throw new Error("Tu ne peux pas supprimer ton propre compte.");
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!target) return;

  if (target.role === "ADMIN" && (await countAdmins()) <= 1) {
    throw new Error("Impossible : c'est le dernier administrateur.");
  }

  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/users");
}
