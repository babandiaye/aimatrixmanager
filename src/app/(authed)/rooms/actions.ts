"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertCan, can, canAny, roomScopeFor } from "@/lib/permissions";
import {
  resolveTeacherCourseIds,
  roomWhereForTeacher,
} from "@/lib/teacher-scope";
import type { Prisma, UserRole } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import {
  enableRoomEncryption,
  joinUserToRoom,
  listAllRooms,
  setRoomName,
  userLeaveRoom,
} from "@/lib/synapse-admin";
import { z } from "zod";
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "rooms.actions" });

/**
 * Garantit qu'un user n'agisse pas sur un salon hors de son scope :
 *  - ADMIN : pas de filtre
 *  - MANAGER/AUDITOR : salons MOODLE uniquement
 *  - ENSEIGNANT : salons MOODLE liés à un cours où il est prof
 * Réponse 404-like (message générique) pour ne pas révéler l'existence.
 */
async function assertRoomAccessible(
  role: UserRole,
  userId: string,
  roomId: string,
) {
  // Compose le where : id strict + scope (source/courseId filter)
  let where: Prisma.RoomWhereInput = { id: roomId, ...roomScopeFor(role) };
  if (role === "ENSEIGNANT") {
    const teacherCourseIds = await resolveTeacherCourseIds(userId);
    where = {
      id: roomId,
      AND: roomWhereForTeacher("ENSEIGNANT", teacherCourseIds),
    };
  }
  const room = await prisma.room.findFirst({
    where,
    select: { id: true },
  });
  if (!room) throw new Error("Salon introuvable");
}

/**
 * Vérifie qu'un ENSEIGNANT peut affecter cet agent : doit en être créateur.
 * Pour ADMIN/MANAGER : pas de restriction, ils ont `rooms.assign`.
 */
async function assertAgentAssignable(
  role: UserRole,
  userId: string,
  agentId: string,
) {
  if (can(role, "rooms.assign")) return; // ADMIN/MANAGER
  if (!can(role, "rooms.assign-own")) {
    throw new Error(`Forbidden: rôle ${role} ne peut pas affecter d'agent`);
  }
  // ENSEIGNANT : l'agent doit lui appartenir
  const a = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { createdById: true },
  });
  if (!a || a.createdById !== userId) {
    throw new Error("Forbidden: cet agent n'est pas le vôtre");
  }
}

export async function syncRoomsFromSynapse(): Promise<{
  total: number;
  inserted: number;
  updated: number;
}> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "rooms.assign");

  const synapseRooms = await listAllRooms();
  let inserted = 0,
    updated = 0;

  for (const r of synapseRooms) {
    const existing = await prisma.room.findUnique({
      where: { matrixRoomId: r.room_id },
    });
    const data = {
      name: r.name,
      isDirect: r.joined_members <= 2,
      isEncrypted: !!r.encryption,
    };
    if (existing) {
      await prisma.room.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.room.create({
        data: { matrixRoomId: r.room_id, ...data },
      });
      inserted++;
    }
  }

  log.info(
    { total: synapseRooms.length, inserted, updated },
    "Sync Synapse rooms",
  );
  revalidatePath("/rooms");
  return { total: synapseRooms.length, inserted, updated };
}

export async function assignAgentToRoom(roomId: string, agentId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  await assertAgentAssignable(session.user.role, session.user.id, agentId);
  await assertRoomAccessible(session.user.role, session.user.id, roomId);

  const [room, agent] = await Promise.all([
    prisma.room.findUniqueOrThrow({
      where: { id: roomId },
      select: { matrixRoomId: true },
    }),
    prisma.agent.findUniqueOrThrow({
      where: { id: agentId },
      select: { matrixUserId: true, slug: true },
    }),
  ]);

  // 1. Faire rejoindre le compte Matrix de l'agent au salon (idempotent)
  try {
    await joinUserToRoom({
      matrixUserId: agent.matrixUserId,
      matrixRoomId: room.matrixRoomId,
    });
    log.info(
      { agent: agent.slug, room: room.matrixRoomId },
      "Agent joined room",
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Synapse renvoie une erreur si le user est déjà membre — on ignore.
    if (!/already.*(in|member)/i.test(msg)) {
      throw new Error(
        `Impossible de faire rejoindre @${agent.slug} au salon : ${msg}`,
      );
    }
    log.info(
      { agent: agent.slug, room: room.matrixRoomId },
      "Agent already in room",
    );
  }

  // 2. Enregistre l'assignation
  await prisma.roomAgent.upsert({
    where: { roomId_agentId: { roomId, agentId } },
    update: { enabled: true },
    create: {
      roomId,
      agentId,
      enabled: true,
      assignedById: session.user.id,
    },
  });

  revalidatePath(`/rooms/${roomId}`);
  revalidatePath("/rooms");
}

export async function unassignAgent(assignmentId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (!canAny(session.user.role, "rooms.assign", "rooms.assign-own")) {
    throw new Error("Forbidden: pas de permission rooms.assign");
  }

  // Scope room : ENSEIGNANT doit en plus appartenir au cours via les
  // chunks résolus, on délègue à roomWhereForTeacher après une résolution
  const teacherCourseIds =
    session.user.role === "ENSEIGNANT"
      ? await resolveTeacherCourseIds(session.user.id)
      : null;
  const a = await prisma.roomAgent.findFirst({
    where: {
      id: assignmentId,
      room: roomWhereForTeacher(session.user.role, teacherCourseIds),
    },
    include: {
      room: { select: { matrixRoomId: true } },
      agent: { select: { slug: true, matrixAccessToken: true } },
    },
  });
  if (!a) return;

  // Best-effort : faire quitter le bot du salon (avec son propre token)
  if (a.agent.matrixAccessToken) {
    try {
      await userLeaveRoom({
        matrixRoomId: a.room.matrixRoomId,
        userAccessToken: decrypt(a.agent.matrixAccessToken),
      });
      log.info(
        { agent: a.agent.slug, room: a.room.matrixRoomId },
        "Agent left room",
      );
    } catch (e) {
      log.warn({ err: e }, "Échec leave (ignoré, on supprime quand même)");
    }
  }

  await prisma.roomAgent.delete({ where: { id: assignmentId } });
  revalidatePath(`/rooms/${a.roomId}`);
  revalidatePath("/rooms");
}

export async function toggleAssignmentEnabled(
  assignmentId: string,
  enabled: boolean,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (!canAny(session.user.role, "rooms.assign", "rooms.assign-own")) {
    throw new Error("Forbidden: pas de permission rooms.assign");
  }

  const teacherCourseIds =
    session.user.role === "ENSEIGNANT"
      ? await resolveTeacherCourseIds(session.user.id)
      : null;
  const existing = await prisma.roomAgent.findFirst({
    where: {
      id: assignmentId,
      room: roomWhereForTeacher(session.user.role, teacherCourseIds),
    },
    select: { id: true },
  });
  if (!existing) throw new Error("Affectation introuvable");

  const a = await prisma.roomAgent.update({
    where: { id: assignmentId },
    data: { enabled },
    select: { roomId: true },
  });
  revalidatePath(`/rooms/${a.roomId}`);
  revalidatePath("/rooms");
}

const renameSchema = z
  .string()
  .min(1, "Nom requis")
  .max(255, "255 caractères maximum");

/**
 * Renomme un salon Matrix (state event m.room.name).
 * Permission : `rooms.assign` (Admin/Manager).
 */
export async function renameRoom(roomId: string, newName: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (!canAny(session.user.role, "rooms.assign", "rooms.assign-own")) {
    throw new Error("Forbidden: pas de permission rooms.assign");
  }
  await assertRoomAccessible(session.user.role, session.user.id, roomId);

  const parsed = renameSchema.safeParse(newName.trim());
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const room = await prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    select: { matrixRoomId: true },
  });

  await setRoomName(room.matrixRoomId, parsed.data);
  await prisma.room.update({
    where: { id: roomId },
    data: { name: parsed.data },
  });

  log.info(
    { roomId: room.matrixRoomId, newName: parsed.data },
    "Salon renommé",
  );
  revalidatePath(`/rooms/${roomId}`);
  revalidatePath("/rooms");
}

/**
 * Active le chiffrement E2EE d'un salon. Irréversible côté Matrix.
 */
export async function activateRoomEncryption(roomId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  // Activer E2EE est une action critique réservée à ADMIN/MANAGER (irréversible)
  assertCan(session.user.role, "rooms.assign");
  await assertRoomAccessible(session.user.role, session.user.id, roomId);

  const room = await prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    select: { matrixRoomId: true, isEncrypted: true },
  });
  if (room.isEncrypted) {
    throw new Error("Le salon est déjà chiffré");
  }

  await enableRoomEncryption(room.matrixRoomId);
  await prisma.room.update({
    where: { id: roomId },
    data: { isEncrypted: true },
  });

  log.info({ roomId: room.matrixRoomId }, "Chiffrement E2EE activé");
  revalidatePath(`/rooms/${roomId}`);
  revalidatePath("/rooms");
}

export async function linkRoomToCourse(
  roomId: string,
  moodleCourseId: string | null,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  // Lier une room à un cours est réservé à ADMIN/MANAGER — l'enseignant ne
  // peut pas réaffecter des rooms à des cours arbitraires.
  assertCan(session.user.role, "rooms.assign");
  await assertRoomAccessible(session.user.role, session.user.id, roomId);

  await prisma.room.update({
    where: { id: roomId },
    data: { moodleCourseId },
  });
  revalidatePath(`/rooms/${roomId}`);
  revalidatePath("/rooms");
}
