import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/permissions";
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

export default async function RoomDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "rooms.view")) redirect("/");

  const canAssign = can(session.user.role, "rooms.assign");

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

  // Non-ADMIN : ne voit que les salons provenant de Moodle. On répond 404
  // (pas 403) pour ne pas révéler l'existence des salons natifs.
  if (session.user.role !== "ADMIN" && room.source !== "MOODLE") {
    notFound();
  }

  // Listes pour les selectors
  const allAgents = await prisma.agent.findMany({
    where: { status: { not: "SUSPENDED" } },
    select: { id: true, slug: true, name: true, status: true },
    orderBy: { slug: "asc" },
  });
  const assignedAgentIds = new Set(room.assignments.map((a) => a.agentId));
  const availableAgents = allAgents.filter((a) => !assignedAgentIds.has(a.id));

  const allCourses = await prisma.moodleCourse.findMany({
    include: { platform: { select: { key: true } } },
    orderBy: [{ platform: { key: "asc" } }, { shortname: "asc" }],
  });

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

      {canAssign && (
        <AdminCard
          roomId={room.id}
          matrixRoomId={room.matrixRoomId}
          currentName={room.name}
          isEncrypted={room.isEncrypted}
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
            l&apos;agent (RAG, Phase 8).
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
            courses={allCourses.map((c) => ({
              id: c.id,
              label: `[${c.platform.key}] ${c.shortname} — ${c.fullname}`,
            }))}
            canAssign={canAssign}
          />
        </CardContent>
      </Card>
    </div>
  );
}
