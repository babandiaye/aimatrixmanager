"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
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
  assertCan(session.user.role, "rooms.assign");

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
  assertCan(session.user.role, "rooms.assign");

  const a = await prisma.roomAgent.findUnique({
    where: { id: assignmentId },
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
  assertCan(session.user.role, "rooms.assign");

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
  assertCan(session.user.role, "rooms.assign");

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
  assertCan(session.user.role, "rooms.assign");

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
  assertCan(session.user.role, "rooms.assign");

  await prisma.room.update({
    where: { id: roomId },
    data: { moodleCourseId },
  });
  revalidatePath(`/rooms/${roomId}`);
  revalidatePath("/rooms");
}
