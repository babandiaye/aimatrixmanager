import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  agentWhereFor,
  resolveTeacherCourseIds,
  roomWhereForTeacher,
} from "@/lib/teacher-scope";
import { getSystemHealth, type HealthItem } from "@/lib/health";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { SectionHeader } from "@/components/ui/section-header";
import {
  CpuChipIcon,
  ChatBubbleLeftRightIcon,
  AcademicCapIcon,
  BookOpenIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) return null;

  const teacherCourseIds =
    session.user.role === "ENSEIGNANT"
      ? await resolveTeacherCourseIds(session.user.id)
      : null;
  const agentWhere = agentWhereFor(session.user.role, session.user.id);
  const roomWhere = roomWhereForTeacher(session.user.role, teacherCourseIds);

  // Cours Moodle qui ont au moins un salon Matrix (source=MOODLE) lié.
  // ENSEIGNANT : restreint à ses cours.
  const matrixCoursesWhere = {
    rooms: { some: { source: "MOODLE" as const } },
    ...(session.user.role === "ENSEIGNANT" && teacherCourseIds
      ? { id: { in: teacherCourseIds } }
      : {}),
  };

  const [
    agentTotal,
    agentEnabled,
    roomTotal,
    assignmentActive,
    platformActive,
    courseTotal,
    matrixCourses,
    health,
  ] = await Promise.all([
    prisma.agent.count({ where: agentWhere }),
    prisma.agent.count({ where: { ...agentWhere, status: "ENABLED" } }),
    prisma.room.count({ where: roomWhere }),
    prisma.roomAgent.count({
      where: { enabled: true, room: roomWhere },
    }),
    prisma.moodlePlatform.count({ where: { enabled: true } }),
    session.user.role === "ENSEIGNANT"
      ? (teacherCourseIds?.length ?? 0)
      : prisma.moodleCourse.count(),
    prisma.moodleCourse.findMany({
      where: matrixCoursesWhere,
      include: {
        platform: { select: { key: true, baseUrl: true } },
        rooms: {
          where: { source: "MOODLE" },
          select: {
            id: true,
            name: true,
            assignments: {
              where: { enabled: true },
              select: { agent: { select: { slug: true } } },
            },
          },
        },
      },
      orderBy: [{ platformId: "asc" }, { fullname: "asc" }],
      take: 8,
    }),
    getSystemHealth(),
  ]);

  const matrixCoursesTotal = await prisma.moodleCourse.count({
    where: matrixCoursesWhere,
  });

  return (
    <div className="space-y-8">
      <PageHeader
        icon={ChartBarIcon}
        title="Tableau de bord"
        description={`Bonjour ${session.user.name?.split(" ")[0] ?? "—"}, voici l'état de tes agents IA.`}
      />

      {/* KPIs — cards cliquables (wrapper Link autour) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/agents" className="block">
          <KpiCard
            icon={CpuChipIcon}
            value={`${agentEnabled}/${agentTotal}`}
            label="Agents actifs / total"
          />
        </Link>
        <Link href="/rooms" className="block">
          <KpiCard
            icon={ChatBubbleLeftRightIcon}
            value={assignmentActive}
            label={`Affectations sur ${roomTotal} salons`}
          />
        </Link>
        <Link href="/moodle" className="block">
          <KpiCard
            icon={AcademicCapIcon}
            value={platformActive}
            label="Plateformes Moodle actives"
          />
        </Link>
        <Link href="/moodle" className="block">
          <KpiCard
            icon={BookOpenIcon}
            value={courseTotal}
            label="Cours synchronisés"
            accent
          />
        </Link>
      </div>

      {/* Cours avec activité Matrix */}
      <section className="space-y-3">
        <SectionHeader
          title={
            <>
              Cours Moodle avec activité Matrix
              {matrixCoursesTotal > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({matrixCoursesTotal})
                </span>
              )}
            </>
          }
          description={
            <>
              Cours dont au moins un salon Matrix est rattaché via le plugin{" "}
              <code>mod_matrix</code>.
            </>
          }
        />
        <Card>
        <CardContent>
          {matrixCourses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun cours n&apos;a encore d&apos;activité Matrix liée.
              Synchronise les activités depuis{" "}
              <Link href="/moodle" className="text-primary hover:underline">
                /moodle
              </Link>{" "}
              pour les détecter.
            </p>
          ) : (
            <ul className="space-y-2">
              {matrixCourses.map((c) => {
                const agentSlugs = new Set<string>();
                for (const r of c.rooms)
                  for (const a of r.assignments)
                    agentSlugs.add(a.agent.slug);
                const moodleUrl = `${c.platform.baseUrl}/course/view.php?id=${c.moodleId}`;
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <StatusBadge status="neutral" className="font-mono">
                          {c.platform.key}
                        </StatusBadge>
                        <span className="truncate font-medium text-foreground">
                          {c.fullname}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-mono">{c.shortname}</span>
                        <span>
                          <ChatBubbleLeftRightIcon className="inline size-3.5" />{" "}
                          {c.rooms.length} salon{c.rooms.length > 1 ? "s" : ""}
                        </span>
                        <span>
                          <CpuChipIcon className="inline size-3.5" />{" "}
                          {agentSlugs.size === 0
                            ? "aucun agent"
                            : `${agentSlugs.size} agent${agentSlugs.size > 1 ? "s" : ""}`}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {c.rooms.length === 1 ? (
                        <Link
                          href={`/rooms/${c.rooms[0].id}`}
                          className="text-xs text-primary hover:underline"
                        >
                          Salon →
                        </Link>
                      ) : (
                        <Link
                          href="/rooms?sort=source-moodle"
                          className="text-xs text-primary hover:underline"
                        >
                          {c.rooms.length} salons →
                        </Link>
                      )}
                      <a
                        href={moodleUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                        title="Ouvrir dans Moodle"
                      >
                        <ArrowTopRightOnSquareIcon className="size-4" />
                      </a>
                    </div>
                  </li>
                );
              })}
              {matrixCoursesTotal > matrixCourses.length && (
                <li className="pt-2 text-center">
                  <Link
                    href={
                      session.user.role === "ENSEIGNANT"
                        ? "/mes-cours"
                        : "/moodle"
                    }
                    className="text-xs text-primary hover:underline"
                  >
                    Voir les {matrixCoursesTotal - matrixCourses.length} autre(s)
                    →
                  </Link>
                </li>
              )}
            </ul>
          )}
        </CardContent>
        </Card>
      </section>

      {/* État des services */}
      <section className="space-y-3">
        <SectionHeader
          title="État des services"
          description="Vérification temps-réel — seuils : DB <100 ms, agents en ligne si heartbeat <90 s."
        />
        <Card>
          <CardContent>
            <ul className="space-y-2">
              {health.map((h) => (
                <HealthRow key={h.key} item={h} />
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function HealthRow({ item }: { item: HealthItem }) {
  const Icon =
    item.status === "ok"
      ? CheckCircleIcon
      : item.status === "warn"
        ? ExclamationTriangleIcon
        : XCircleIcon;
  const tone =
    item.status === "ok"
      ? "text-status-published"
      : item.status === "warn"
        ? "text-status-unpublished"
        : "text-status-error";
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon className={`size-5 shrink-0 ${tone}`} />
        <span className="font-medium text-foreground">{item.label}</span>
      </div>
      <div className="flex items-center gap-3">
        {item.detail && (
          <span className="text-xs text-muted-foreground font-mono">
            {item.detail}
          </span>
        )}
        <StatusBadge
          status={
            item.status === "ok"
              ? "published"
              : item.status === "warn"
                ? "unpublished"
                : "error"
          }
        >
          {item.status === "ok"
            ? "OK"
            : item.status === "warn"
              ? "warn"
              : "down"}
        </StatusBadge>
      </div>
    </li>
  );
}

