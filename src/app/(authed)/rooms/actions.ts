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
  deleteRoomHard,
  enableRoomEncryption,
  getRoomStateSummary,
  joinUserToRoom,
  listAllRooms,
  setRoomName,
  userLeaveRoom,
} from "@/lib/synapse-admin";
import { enableRagIfCourseIndexable } from "@/lib/moodle-matrix-sync";
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
    updated = 0,
    moodleLinked = 0;
  // Cours effectivement liés à un salon → auto-enable RAG en fin de sync
  const linkedCourseIds = new Set<string>();

  for (const r of synapseRooms) {
    const existing = await prisma.room.findUnique({
      where: { matrixRoomId: r.room_id },
    });

    // Lit l'état complet du salon pour deux infos :
    //   1. `org.matrix.moodle.course_id` posé par mod_matrix dans
    //      `m.room.create` → source d'origine du salon.
    //   2. `is_direct: true` dans les member events → seule vraie
    //      sémantique Matrix d'un DM (l'ancien heuristique
    //      `joined_members <= 2` flagait à tort les petits groupes).
    // Best-effort : si le state fetch échoue (salon parti, permissions…),
    // on retombe sur des valeurs neutres pour ne pas bloquer la sync.
    let stateSummary: Awaited<ReturnType<typeof getRoomStateSummary>>;
    try {
      stateSummary = await getRoomStateSummary(r.room_id);
    } catch (e) {
      log.warn(
        { err: e, roomId: r.room_id },
        "getRoomStateSummary échoué — fallback neutre",
      );
      stateSummary = { moodleCourseId: null, isDirect: false };
    }

    // Résolution moodleCourseId (interne DB) à partir du moodleId Moodle.
    // Si plusieurs cours matchent (multi-plateformes avec même course id),
    // on tag source=MOODLE sans lier — log warn pour investigation.
    let moodleCourseIdDb: string | null = null;
    if (stateSummary.moodleCourseId !== null) {
      const candidates = await prisma.moodleCourse.findMany({
        where: { moodleId: stateSummary.moodleCourseId },
        select: { id: true },
      });
      if (candidates.length === 1) {
        moodleCourseIdDb = candidates[0].id;
      } else if (candidates.length > 1) {
        log.warn(
          {
            roomId: r.room_id,
            moodleCourseId: stateSummary.moodleCourseId,
            candidates: candidates.length,
          },
          "Lien MoodleCourse ambigu (même moodleId sur plusieurs plateformes) — source=MOODLE sans lien",
        );
      }
      moodleLinked++;
    }

    const baseData = {
      name: r.name,
      isDirect: stateSummary.isDirect,
      isEncrypted: !!r.encryption,
    };
    // Politique monotone pour ne pas régresser un lien déjà posé par la sync
    // Moodle (côté /moodle, via matrix_room_id direct ou fuzzy par nom) :
    //  - source : on n'écrase JAMAIS un MOODLE existant vers MATRIX ; on
    //    upgrade juste MATRIX → MOODLE si le marker est présent.
    //  - moodleCourseId : on ne set que si notre lookup a trouvé exactement
    //    un cours ; sinon on laisse la valeur existante intacte.
    const moodleData: {
      source?: "MOODLE";
      moodleCourseId?: string;
    } = {};
    if (stateSummary.moodleCourseId !== null) {
      moodleData.source = "MOODLE";
      if (moodleCourseIdDb !== null) {
        moodleData.moodleCourseId = moodleCourseIdDb;
        linkedCourseIds.add(moodleCourseIdDb);
      }
    }

    if (existing) {
      await prisma.room.update({
        where: { id: existing.id },
        data: { ...baseData, ...moodleData },
      });
      updated++;
    } else {
      await prisma.room.create({
        data: {
          matrixRoomId: r.room_id,
          ...baseData,
          ...moodleData,
        },
      });
      inserted++;
    }
  }

  // Auto-enable RAG sur les cours liés à un salon dans cette passe.
  // Non-bloquant : un échec de lookup ne casse pas la sync entière.
  for (const courseId of linkedCourseIds) {
    try {
      await enableRagIfCourseIndexable(courseId);
    } catch (e) {
      log.warn(
        { err: e, courseId },
        "Auto-enable RAG échoué pour ce cours (skip, non-bloquant)",
      );
    }
  }

  log.info(
    { total: synapseRooms.length, inserted, updated, moodleLinked },
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

/**
 * Force le bot à rejoindre le salon maintenant via l'API Synapse Admin.
 * Utilisé après un kick définitif (autoRejoinOnKick=off) ou après que
 * l'auto-disable a déclenché (l'utilisateur veut rétablir la situation
 * sans attendre).
 *
 * Côté UI :
 *  - Réactive l'assignation si elle a été désactivée (enabled=false)
 *  - Reset le compteur d'échecs à 0
 *  - Appelle `joinUserToRoom` (idempotent : si le bot est déjà membre,
 *    Synapse renvoie 200 sans rien faire)
 */
export async function manualRejoinAgent(assignmentId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (!canAny(session.user.role, "rooms.assign", "rooms.assign-own")) {
    throw new Error("Forbidden: pas de permission rooms.assign");
  }

  const teacherCourseIds =
    session.user.role === "ENSEIGNANT"
      ? await resolveTeacherCourseIds(session.user.id)
      : null;
  const ra = await prisma.roomAgent.findFirst({
    where: {
      id: assignmentId,
      room: roomWhereForTeacher(session.user.role, teacherCourseIds),
    },
    select: {
      id: true,
      roomId: true,
      room: { select: { matrixRoomId: true } },
      agent: { select: { matrixUserId: true, slug: true } },
    },
  });
  if (!ra) throw new Error("Affectation introuvable");

  await joinUserToRoom({
    matrixUserId: ra.agent.matrixUserId,
    matrixRoomId: ra.room.matrixRoomId,
  });

  await prisma.roomAgent.update({
    where: { id: ra.id },
    data: { enabled: true, rejoinFailCount: 0 },
  });

  log.info(
    { assignmentId, slug: ra.agent.slug, by: session.user.id },
    "manual rejoin",
  );
  revalidatePath(`/rooms/${ra.roomId}`);
}

/**
 * Réinitialise juste le compteur d'échecs de rejoin (sans toucher à
 * `enabled` ni `autoRejoinOnKick`). Permet de redonner une chance au bot
 * après avoir corrigé la cause des kicks, sans bouger le reste de la
 * policy.
 */
export async function resetRejoinFailCount(assignmentId: string) {
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
    data: { rejoinFailCount: 0 },
    select: { roomId: true },
  });
  revalidatePath(`/rooms/${a.roomId}`);
}

/**
 * Toggle `autoRejoinOnKick` sur une affectation. Si désactivé, un kick admin
 * du bot laisse le salon sans intervention. Si activé (défaut), le bot
 * retente automatiquement le join (avec cooldown 5 min, et auto-disable
 * après 3 échecs consécutifs).
 *
 * Lors d'une réactivation, on remet aussi le compteur d'échecs à zéro pour
 * laisser une chance fraîche au bot.
 */
export async function toggleAutoRejoinOnKick(
  assignmentId: string,
  autoRejoin: boolean,
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
    data: {
      autoRejoinOnKick: autoRejoin,
      ...(autoRejoin ? { rejoinFailCount: 0 } : {}),
    },
    select: { roomId: true },
  });
  revalidatePath(`/rooms/${a.roomId}`);
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

/**
 * Actualise le lien Moodle d'un salon spécifique — ADMIN/MANAGER.
 *
 * Re-lit l'état Matrix du salon (`m.room.create` pour le marker
 * `org.matrix.moodle.course_id`), refait le lookup côté DB et met
 * à jour `source` + `moodleCourseId` en conséquence. Auto-enable
 * ensuite le RAG sur le cours si celui-ci a des ressources indexables.
 *
 * Utile quand le sync global n'a pas encore été relancé ou quand un
 * cours vient d'être créé côté Moodle et qu'on veut lier tout de suite.
 * Retourne un rapport pour l'affichage UI (was linked → now linked to,
 * RAG activé ou non).
 */
export async function refreshRoomMoodleLink(roomId: string): Promise<{
  linked: boolean;
  courseId: string | null;
  courseShortname: string | null;
  ragAutoEnabled: boolean;
  indexableResources: number;
  message: string;
}> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  assertCan(session.user.role, "rooms.assign");

  const room = await prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    select: { matrixRoomId: true, moodleCourseId: true },
  });

  const summary = await getRoomStateSummary(room.matrixRoomId);
  if (summary.moodleCourseId === null) {
    return {
      linked: false,
      courseId: null,
      courseShortname: null,
      ragAutoEnabled: false,
      indexableResources: 0,
      message:
        "Ce salon n'a pas de marker Moodle (org.matrix.moodle.course_id) dans son m.room.create — il n'a pas été créé par le plugin mod_matrix.",
    };
  }

  // Résolution du MoodleCourse interne à partir du moodleId Moodle.
  const candidates = await prisma.moodleCourse.findMany({
    where: { moodleId: summary.moodleCourseId },
    select: { id: true, shortname: true },
  });

  if (candidates.length === 0) {
    // Marker présent mais pas de MoodleCourse en DB — on tag source=MOODLE
    // sans lier. L'ADMIN doit d'abord synchroniser le cours côté /moodle.
    await prisma.room.update({
      where: { id: roomId },
      data: { source: "MOODLE" },
    });
    revalidatePath(`/rooms/${roomId}`);
    revalidatePath("/rooms");
    return {
      linked: false,
      courseId: null,
      courseShortname: null,
      ragAutoEnabled: false,
      indexableResources: 0,
      message: `Marker Moodle détecté (course=${summary.moodleCourseId}) mais ce cours n'est pas encore synchronisé dans AI Bot Manager. Lance d'abord la sync côté /moodle.`,
    };
  }

  if (candidates.length > 1) {
    // Multi-plateformes avec même moodleId — on ne peut pas trancher.
    return {
      linked: false,
      courseId: null,
      courseShortname: null,
      ragAutoEnabled: false,
      indexableResources: 0,
      message: `Lien ambigu : le moodleId ${summary.moodleCourseId} existe sur ${candidates.length} plateformes différentes. Lien à faire manuellement.`,
    };
  }

  const target = candidates[0];
  await prisma.room.update({
    where: { id: roomId },
    data: { source: "MOODLE", moodleCourseId: target.id },
  });

  const rag = await enableRagIfCourseIndexable(target.id);

  log.info(
    {
      roomId: room.matrixRoomId,
      courseId: target.id,
      shortname: target.shortname,
      ragAutoEnabled: rag.enabled,
      by: session.user.email,
    },
    "Lien Moodle actualisé pour le salon",
  );

  revalidatePath(`/rooms/${roomId}`);
  revalidatePath("/rooms");
  return {
    linked: true,
    courseId: target.id,
    courseShortname: target.shortname,
    ragAutoEnabled: rag.enabled,
    indexableResources: rag.indexableResources,
    message: rag.enabled
      ? `Lié au cours "${target.shortname}" — RAG activé (${rag.indexableResources} ressource(s) indexable(s)).`
      : `Lié au cours "${target.shortname}" — RAG non activé (0 ressource indexable ou déjà activé manuellement).`,
  };
}

/**
 * Suppression complète d'un salon — ADMIN uniquement.
 *
 * Fait DEUX choses, dans cet ordre :
 *  1. `deleteRoomHard()` sur Synapse admin v2 → purge async côté Matrix
 *     (historique, keys, médias, kick des membres). Irréversible.
 *  2. `prisma.room.delete()` → cascade Prisma sur RoomAgent + AuditLog.
 *
 * Portée voulue : ADMIN seul. On ne passe pas par `rooms.assign` (qui
 * inclurait MANAGER) mais par un test strict `role === "ADMIN"`.
 *
 * Si l'appel Synapse échoue, on NE supprime PAS la ligne DB — sinon on
 * se retrouve avec un salon Matrix orphelin invisible depuis l'app.
 */
export async function deleteRoom(roomId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "ADMIN") {
    throw new Error("Action réservée aux administrateurs");
  }

  const room = await prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    select: { matrixRoomId: true, name: true },
  });

  await deleteRoomHard(room.matrixRoomId);
  await prisma.room.delete({ where: { id: roomId } });

  log.warn(
    {
      roomId: room.matrixRoomId,
      name: room.name,
      by: session.user.email,
    },
    "Salon supprimé (purge Matrix + DB)",
  );
  revalidatePath("/rooms");
}

export async function linkRoomToCourse(
  roomId: string,
  moodleCourseId: string | null,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  // Lier ou délier le cours Moodle d'un salon pour activer le RAG dessus.
  // - ADMIN/MANAGER : peuvent associer le salon à n'importe quel cours.
  // - ENSEIGNANT : peut associer son salon (vérifié par `roomScope`) à un
  //   de SES propres cours (vérifié contre `resolveTeacherCourseIds`).
  if (!canAny(session.user.role, "rooms.assign", "rooms.assign-own")) {
    throw new Error("Forbidden: pas de permission rooms.assign");
  }
  await assertRoomAccessible(session.user.role, session.user.id, roomId);

  if (session.user.role === "ENSEIGNANT" && moodleCourseId) {
    const teacherCourseIds = await resolveTeacherCourseIds(session.user.id);
    if (!teacherCourseIds.includes(moodleCourseId)) {
      throw new Error(
        "Forbidden: ce cours n'est pas dans vos cours Moodle",
      );
    }
  }

  await prisma.room.update({
    where: { id: roomId },
    data: { moodleCourseId },
  });
  revalidatePath(`/rooms/${roomId}`);
  revalidatePath("/rooms");
}
