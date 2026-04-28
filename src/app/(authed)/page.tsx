import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
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
  ChartBarIcon,
  BoltIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

const HOURS_24 = 24 * 60 * 60 * 1000;

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) return null;

  const since = new Date(Date.now() - HOURS_24);

  const [
    agentTotal,
    agentEnabled,
    roomTotal,
    assignmentActive,
    platformActive,
    courseTotal,
    msgs24,
    errors24,
    tokens24,
    health,
  ] = await Promise.all([
    prisma.agent.count(),
    prisma.agent.count({ where: { status: "ENABLED" } }),
    prisma.room.count(),
    prisma.roomAgent.count({ where: { enabled: true } }),
    prisma.moodlePlatform.count({ where: { enabled: true } }),
    prisma.moodleCourse.count(),
    prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
    prisma.auditLog.count({
      where: { createdAt: { gte: since }, error: { not: null } },
    }),
    prisma.auditLog.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true },
      _avg: { latencyMs: true },
    }),
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

      {/* Activité 24h */}
      <Card>
        <CardHeader>
          <CardTitle>Activité — dernières 24 h</CardTitle>
          <CardDescription>
            Messages traités par les agents IA, coût et latence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <Stat
              icon={ChartBarIcon}
              label="Messages"
              value={fmtNumber(msgs24)}
            />
            <Stat
              icon={BoltIcon}
              label="Tokens (in/out)"
              value={`${fmtNumber(tokens24._sum.inputTokens)}/${fmtNumber(
                tokens24._sum.outputTokens,
              )}`}
            />
            <Stat
              icon={ClockIcon}
              label="Latence moyenne"
              value={
                tokens24._avg.latencyMs
                  ? `${Math.round(tokens24._avg.latencyMs)} ms`
                  : "—"
              }
            />
            <Stat
              icon={ExclamationTriangleIcon}
              label="Erreurs"
              value={String(errors24)}
              tone={errors24 > 0 ? "error" : "ok"}
            />
          </div>
        </CardContent>
      </Card>

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

// ─── Sous-composants locaux ─────────────────────────────────────────────

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

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
  tone?: "ok" | "error";
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={
          tone === "error"
            ? "rounded-lg bg-status-error/10 p-2"
            : "rounded-lg bg-muted p-2"
        }
      >
        <Icon
          className={
            tone === "error"
              ? "size-5 text-status-error"
              : "size-5 text-muted-foreground"
          }
        />
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="text-lg font-semibold text-foreground">{value}</div>
      </div>
    </div>
  );
}
