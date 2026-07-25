import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { can, canAny } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { ChevronLeftIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { AssignmentsManager } from "./assignments-manager";
import { CourseLinker } from "./course-linker";
import { AdminCard } from "./admin-card";
import { RagIndexer } from "./rag-indexer";
import { getRoomStateSummary } from "@/lib/synapse-admin";

export default async function RoomDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAny(session.user.role, "rooms.view", "rooms.view-own")) redirect("/");

  // canAssign : peut assigner un agent à ce salon (ENSEIGNANT sur ses rooms inclus)
  // canAdmin  : actions strictement admin/manager (rename, encryption, link course, RAG)
  const canAssign = canAny(
    session.user.role,
    "rooms.assign",
    "rooms.assign-own",
  );
  const canAdmin = can(session.user.role, "rooms.assign");

  const { id } = await params;
  const room = await prisma.room.findUnique({
    where: { id },
    include: {
      assignments: {
        include: { agent: { select: { id: true, slug: true, name: true, status: true } } },
        orderBy: { createdAt: "asc" },
      },
      moodleCourse: {
        include: { platform: { select: { key: true, name: true } } },
      },
    },
  });
  if (!room) notFound();

  // Stats RAG si un cours est lié — comptage chunks total + embedded
  let ragStats: {
    totalChunks: number;
    embeddedChunks: number;
    reindexEnabled: boolean;
    lastIndexedAt: Date | null;
  } | null = null;
  if (room.moodleCourseId) {
    const courseDetail = await prisma.moodleCourse.findUnique({
      where: { id: room.moodleCourseId },
      select: { reindexEnabled: true, lastIndexedAt: true },
    });
    const total = await prisma.moodleResourceChunk.count({
      where: { courseId: room.moodleCourseId },
    });
    const embedded = await prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*)::bigint AS c FROM "MoodleResourceChunk"
      WHERE "courseId" = ${room.moodleCourseId} AND embedding IS NOT NULL
    `;
    ragStats = {
      totalChunks: total,
      embeddedChunks: Number(embedded[0]?.c ?? 0),
      reindexEnabled: courseDetail?.reindexEnabled ?? false,
      lastIndexedAt: courseDetail?.lastIndexedAt ?? null,
    };
  }

  // Non-ADMIN : ne voit que les salons provenant de Moodle. On répond 404
  // (pas 403) pour ne pas révéler l'existence des salons natifs.
  if (session.user.role !== "ADMIN" && room.source !== "MOODLE") {
    notFound();
  }
  // ENSEIGNANT : vérifie que le salon est dans ses cours
  if (session.user.role === "ENSEIGNANT") {
    const { resolveTeacherCourseIds } = await import("@/lib/teacher-scope");
    const teacherCourseIds = await resolveTeacherCourseIds(session.user.id);
    if (
      !room.moodleCourseId ||
      !teacherCourseIds.includes(room.moodleCourseId)
    ) {
      notFound();
    }
  }

  // Listes pour les selectors — ENSEIGNANT ne voit que ses propres agents
  const allAgents = await prisma.agent.findMany({
    where: {
      status: { not: "SUSPENDED" },
      ...(session.user.role === "ENSEIGNANT"
        ? { createdById: session.user.id }
        : {}),
    },
    select: { id: true, slug: true, name: true, status: true },
    orderBy: { slug: "asc" },
  });
  const assignedAgentIds = new Set(room.assignments.map((a) => a.agentId));
  const availableAgents = allAgents.filter((a) => !assignedAgentIds.has(a.id));

  // CourseLinker : sélecteur du cours Moodle associé au salon pour le RAG.
  // - ENSEIGNANT → ses propres cours (résolus via Moodle WS), filtrés aux
  //   cours indexables.
  // - ADMIN/MANAGER → tous les cours indexables.
  // - Le cours actuellement lié est toujours inclus, pour pouvoir le délier
  //   même s'il a depuis été désindexé ou retiré côté Moodle.
  //
  // « Indexable » = au moins une ressource exploitable par le RAG
  // (book/resource/page/folder/label). On affiche en plus un badge avec
  // le nombre de mod_book pour mettre en avant les cours qui rendent le
  // mieux aujourd'hui dans le RAG.
  const INDEXABLE_MODNAMES = ["book", "resource", "page", "folder", "label"];

  const teacherCourseIdsForLinker =
    session.user.role === "ENSEIGNANT"
      ? await (async () => {
          const { resolveTeacherCourseIds } = await import(
            "@/lib/teacher-scope"
          );
          return resolveTeacherCourseIds(session.user.id);
        })()
      : null;

  // Restreint le sélecteur de cours à la plateforme d'origine du salon —
  // un salon créé par mod_matrix sur la plateforme P12SEJA ne doit pas
  // proposer des cours de DISIDEV. Deux sources d'info, dans l'ordre :
  //
  //  1. `room.moodleCourse.platformId` — cas nominal (salon déjà lié).
  //  2. Marker `org.matrix.moodle.course_id` lu depuis Matrix : on
  //     résout le MoodleCourse correspondant → sa platformId. Best-effort,
  //     on ignore silencieusement toute erreur pour ne pas casser la page.
  //
  // Fallback : `null` → aucune restriction (comportement d'origine, ex.
  // salon natif Matrix que l'admin veut lier manuellement à un cours).
  let restrictedPlatformId: string | null = room.moodleCourse?.platformId ?? null;
  if (restrictedPlatformId === null) {
    try {
      const summary = await getRoomStateSummary(room.matrixRoomId);
      if (summary.moodleCourseId !== null) {
        const marked = await prisma.moodleCourse.findFirst({
          where: { moodleId: summary.moodleCourseId },
          select: { platformId: true },
        });
        if (marked) restrictedPlatformId = marked.platformId;
      }
    } catch {
      // silencieux — best-effort
    }
  }

  const indexableCoursesRaw = await prisma.moodleCourse.findMany({
    where: {
      AND: [
        // Au moins une ressource RAGable (jointure via sections)
        {
          sections: {
            some: {
              resources: { some: { modname: { in: INDEXABLE_MODNAMES } } },
            },
          },
        },
        // Restriction plateforme du salon
        ...(restrictedPlatformId !== null
          ? [{ platformId: restrictedPlatformId }]
          : []),
        // Scope ENSEIGNANT
        ...(teacherCourseIdsForLinker !== null
          ? [{ id: { in: teacherCourseIdsForLinker } }]
          : []),
      ],
    },
    include: {
      platform: { select: { key: true } },
      sections: {
        select: {
          resources: {
            where: { modname: "book" },
            select: { id: true },
          },
        },
      },
    },
    orderBy: [{ platform: { key: "asc" } }, { shortname: "asc" }],
  });

  // Garantit que le cours actuellement lié est dans la liste (cas où il
  // ne matche plus les filtres ci-dessus : indexation retirée, ENSEIGNANT
  // qui a perdu le cours côté Moodle, etc.).
  if (
    room.moodleCourseId &&
    !indexableCoursesRaw.some((c) => c.id === room.moodleCourseId)
  ) {
    const fallback = await prisma.moodleCourse.findUnique({
      where: { id: room.moodleCourseId },
      include: {
        platform: { select: { key: true } },
        sections: {
          select: {
            resources: { where: { modname: "book" }, select: { id: true } },
          },
        },
      },
    });
    if (fallback) indexableCoursesRaw.unshift(fallback);
  }

  const allCourses = indexableCoursesRaw.map((c) => ({
    id: c.id,
    platformKey: c.platform.key,
    shortname: c.shortname,
    fullname: c.fullname,
    bookCount: c.sections.reduce((s, sec) => s + sec.resources.length, 0),
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/rooms"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" />
          Retour aux salons
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          {room.name ?? (
            <span className="text-muted-foreground italic">(sans nom)</span>
          )}
        </h1>
        <p className="font-mono text-xs text-muted-foreground">
          {room.matrixRoomId}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Informations</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <div className="text-xs uppercase text-muted-foreground tracking-wider">
              Type
            </div>
            <div className="mt-1 flex items-center gap-2">
              {room.isDirect ? "Direct (DM)" : "Groupe"}
              {room.isEncrypted && (
                <span className="inline-flex items-center gap-1 text-xs text-status-published">
                  <LockClosedIcon className="size-3.5" />
                  E2EE
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground tracking-wider">
              Découvert le
            </div>
            <div className="mt-1">
              {room.discoveredAt.toLocaleDateString("fr-FR")}
            </div>
          </div>
          {room.topic && (
            <div className="md:col-span-2">
              <div className="text-xs uppercase text-muted-foreground tracking-wider">
                Topic
              </div>
              <div className="mt-1">{room.topic}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {canAdmin && (
        <AdminCard
          roomId={room.id}
          matrixRoomId={room.matrixRoomId}
          currentName={room.name}
          isEncrypted={room.isEncrypted}
          canDelete={session.user.role === "ADMIN"}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Agents IA assignés</CardTitle>
          <CardDescription>
            Quand un étudiant écrit <code>@slug …</code>, l&apos;agent
            correspondant répond. Un agent doit être <code>ENABLED</code>{" "}
            globalement et <code>actif</code> ici.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AssignmentsManager
            roomId={room.id}
            assignments={room.assignments.map((a) => ({
              id: a.id,
              enabled: a.enabled,
              autoRejoinOnKick: a.autoRejoinOnKick,
              rejoinFailCount: a.rejoinFailCount,
              agent: a.agent,
            }))}
            availableAgents={availableAgents}
            canAssign={canAssign}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cours Moodle lié</CardTitle>
          <CardDescription>
            Permet d&apos;injecter le contexte du cours dans les réponses de
            l&apos;agent (RAG).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CourseLinker
            roomId={room.id}
            currentCourseId={room.moodleCourseId}
            currentCourse={
              room.moodleCourse && {
                shortname: room.moodleCourse.shortname,
                fullname: room.moodleCourse.fullname,
                platformKey: room.moodleCourse.platform.key,
              }
            }
            courses={allCourses}
            canAssign={canAssign}
          />
        </CardContent>
      </Card>

      {room.moodleCourseId && room.moodleCourse && ragStats && (
        <Card>
          <CardHeader>
            <CardTitle>Indexation RAG du cours</CardTitle>
            <CardDescription>
              Extrait le texte des supports Moodle (PDF, pages, labels),
              découpe en chunks et calcule les embeddings via{" "}
              <code>nomic-embed-text</code> sur fromager. Les agents affectés
              à ce salon utilisent ces chunks pour répondre avec le contexte
              du cours.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RagIndexer
              courseDbId={room.moodleCourseId}
              reindexEnabled={ragStats.reindexEnabled}
              totalChunks={ragStats.totalChunks}
              embeddedChunks={ragStats.embeddedChunks}
              lastIndexedAt={ragStats.lastIndexedAt}
              canIndex={canAdmin}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
