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
import {
  CpuChipIcon,
  ChatBubbleLeftRightIcon,
  AcademicCapIcon,
  BookOpenIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
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

  const [
    agentTotal,
    agentEnabled,
    roomTotal,
    assignmentActive,
    platformActive,
    courseTotal,
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
    getSystemHealth(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Tableau de bord
        </h1>
        <p className="text-muted-foreground">
          Bonjour {session.user.name?.split(" ")[0] ?? "—"}, voici l&apos;état
          de tes agents IA.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={CpuChipIcon}
          label="Agents"
          primary={`${agentEnabled} / ${agentTotal}`}
          sub="actifs / total"
          href="/agents"
        />
        <KpiCard
          icon={ChatBubbleLeftRightIcon}
          label="Affectations actives"
          primary={String(assignmentActive)}
          sub={`sur ${roomTotal} salon(s) connus`}
          href="/rooms"
        />
        <KpiCard
          icon={AcademicCapIcon}
          label="Plateformes Moodle"
          primary={String(platformActive)}
          sub="instances actives"
          href="/moodle"
        />
        <KpiCard
          icon={BookOpenIcon}
          label="Cours synchronisés"
          primary={String(courseTotal)}
          sub="référencés en DB"
          href="/moodle"
        />
      </div>

      {/* État des services */}
      <Card>
        <CardHeader>
          <CardTitle>État des services</CardTitle>
          <CardDescription>
            Vérification temps-réel — seuils : DB &lt;100 ms, agents en ligne
            si heartbeat &lt;90 s.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {health.map((h) => (
              <HealthRow key={h.key} item={h} />
            ))}
          </ul>
        </CardContent>
      </Card>
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

function KpiCard({
  icon: Icon,
  label,
  primary,
  sub,
  href,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  primary: string;
  sub: string;
  href: string;
}) {
  return (
    <Link href={href} className="block group">
      <Card className="transition-colors group-hover:bg-muted/30">
        <CardContent className="flex items-center gap-4 py-2">
          <div className="rounded-lg bg-secondary p-3">
            <Icon className="size-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="text-2xl font-semibold text-foreground">
              {primary}
            </div>
            <div className="text-xs text-muted-foreground">{sub}</div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
