import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canAny } from "@/lib/permissions";
import { resolveTeacherCourseIds } from "@/lib/teacher-scope";
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
import { IconTile } from "@/components/ui/icon-tile";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { DashboardIllustration } from "@/components/decorative/dashboard-illustration";
import {
  AcademicCapIcon,
  ArrowRightIcon,
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  CheckCircleIcon,
  CpuChipIcon,
  NoSymbolIcon,
} from "@heroicons/react/24/outline";
import { RefreshMyCoursesButton } from "./refresh-button";

type CourseData = {
  id: string;
  fullname: string;
  shortname: string;
  moodleId: number;
  platform: { key: string; name: string; baseUrl: string };
  rooms: Array<{
    id: string;
    name: string | null;
    assignments: Array<{ agent: { slug: string } }>;
  }>;
  _count: { rooms: number; resources: number };
};

export default async function MesCoursPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAny(session.user.role, "rooms.view", "rooms.view-own")) {
    redirect("/");
  }

  // Résout le scope Moodle "cours où je suis enseignant/tuteur" pour tous
  // les rôles aibotmanager. Cache 1h dans User.moodleUserMap, vidé par
  // le bouton "Rafraîchir depuis Moodle".
  const teacherCourseIds = await resolveTeacherCourseIds(session.user.id);

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { lastMoodleSyncAt: true },
  });
  const lastSync = me?.lastMoodleSyncAt;

  const courses: CourseData[] =
    teacherCourseIds.length > 0
      ? await prisma.moodleCourse.findMany({
          where: { id: { in: teacherCourseIds } },
          include: {
            platform: { select: { key: true, name: true, baseUrl: true } },
            rooms: {
              include: {
                assignments: {
                  where: { enabled: true },
                  select: { agent: { select: { slug: true } } },
                },
              },
            },
            _count: { select: { rooms: true, resources: true } },
          },
          orderBy: [{ platformId: "asc" }, { fullname: "asc" }],
        })
      : [];

  const coursesWithRoom = courses.filter((c) => c._count.rooms > 0);
  const coursesWithoutRoom = courses.filter((c) => c._count.rooms === 0);

  // Agrégats pour les KPI cards
  const totalCourses = courses.length;
  const totalAgents = new Set(
    courses.flatMap((c) =>
      c.rooms.flatMap((r) => r.assignments.map((a) => a.agent.slug)),
    ),
  ).size;

  return (
    <div className="relative min-h-full space-y-8">
      {/* Illustration décorative — position absolue, sous le contenu.
          Masquée sur mobile pour ne pas empiéter. */}
      <DashboardIllustration className="-z-0 opacity-90" />

      {/* Header avec IconTile + titre + timestamp + bouton refresh */}
      <div className="relative z-10">
        <PageHeader
          icon={BookOpenIcon}
          title="Mes cours"
          description="Les cours Moodle où tu es enseignant, tuteur ou tuteur suivi."
          actions={
            // AUDITOR = rôle read-only : pas de raison de laisser déclencher
            // des WS calls vers Moodle depuis /mes-cours.
            session.user.role !== "AUDITOR" ? (
              <RefreshMyCoursesButton />
            ) : null
          }
        />
        {lastSync && (
          <p className="mt-3 flex flex-wrap items-center gap-1.5 pl-16 text-xs text-muted-foreground sm:pl-20">
            Dernière synchronisation :{" "}
            <span className="font-medium">
              {lastSync.toLocaleString("fr-FR")}
            </span>
            <CheckCircleIcon className="size-4 text-status-published" />
          </p>
        )}
      </div>

      {/* KPI row — 4 cards, la dernière (Agents) en accent bleu marine */}
      <div className="relative z-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={BookOpenIcon}
          value={totalCourses}
          label="Cours au total"
        />
        <KpiCard
          icon={ChatBubbleLeftRightIcon}
          value={coursesWithRoom.length}
          label="Avec activité Matrix"
        />
        <KpiCard
          icon={NoSymbolIcon}
          value={coursesWithoutRoom.length}
          label="Sans activité Matrix"
        />
        <KpiCard
          icon={CpuChipIcon}
          value={totalAgents}
          label="Agents déployés"
          accent
        />
      </div>

      {/* Contenu principal */}
      {courses.length === 0 ? (
        <Card className="relative z-10">
          <CardHeader>
            <CardTitle>Aucun cours trouvé</CardTitle>
            <CardDescription>
              Nous n&apos;avons trouvé aucun cours où tu es marqué comme
              enseignant, tuteur ou tuteur suivi côté Moodle pour l&apos;email{" "}
              <code>{session.user.email}</code>. Vérifications :
              <ul className="mt-2 ml-4 list-disc text-xs">
                <li>
                  Ton compte Keycloak utilise le même email que ton compte
                  Moodle ?
                </li>
                <li>
                  Tu as bien un rôle enseignant (editingteacher, teacher,
                  tuteur ou tuteur suivi) dans au moins un cours Moodle ?
                </li>
                <li>
                  La plateforme Moodle est activée côté admin (
                  <code>/moodle</code>) ?
                </li>
                <li>
                  Le cache a été rafraîchi récemment (clique sur{" "}
                  <strong>Rafraîchir depuis Moodle</strong>) ?
                </li>
              </ul>
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="relative z-10 space-y-6">
          {coursesWithRoom.length > 0 && (
            <section className="space-y-4">
              <SectionHeader
                title={`Cours avec activité Matrix (${coursesWithRoom.length})`}
                description="Ces cours ont au moins un salon Matrix lié — tu peux y affecter un agent IA depuis /rooms."
              />
              <div className="grid gap-4 md:grid-cols-2">
                {coursesWithRoom.map((c) => (
                  <CourseCardV2 key={c.id} course={c} />
                ))}
              </div>
            </section>
          )}
          {coursesWithoutRoom.length > 0 && (
            <section className="space-y-4">
              <SectionHeader
                tone="muted"
                title={`Cours sans activité Matrix (${coursesWithoutRoom.length})`}
                description="Aucun salon Matrix n'est encore lié. Un enseignant peut créer une activité mod_matrix côté Moodle, puis cliquer sur Rafraîchir depuis Moodle."
              />
              <div className="grid gap-4 opacity-75 md:grid-cols-2">
                {coursesWithoutRoom.map((c) => (
                  <CourseCardV2 key={c.id} course={c} dimmed />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Card "cours" v2 : header avec IconTile chapeau + badges plateforme/cours,
 * 3 mini-stats (salons/agents/ressources) en grid, section "Salon lié" avec
 * badges d'agents inline, footer avec bouton "Gérer mes agents" + flèche
 * ronde vers /rooms.
 *
 * `dimmed` : version grisée pour les cours sans activité Matrix.
 */
function CourseCardV2({
  course: c,
  dimmed = false,
}: {
  course: CourseData;
  dimmed?: boolean;
}) {
  const allAgents = new Set<string>();
  for (const r of c.rooms) {
    for (const a of r.assignments) allAgents.add(a.agent.slug);
  }
  const courseUrl = `${c.platform.baseUrl}/course/view.php?id=${c.moodleId}`;
  const firstRoom = c.rooms[0];
  const primaryLinkedRoom = c.rooms.find((r) => r.assignments.length > 0);
  const targetRoomId = primaryLinkedRoom?.id ?? firstRoom?.id;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 ring-1 ring-foreground/5 transition-shadow hover:shadow-md">
      {/* Header : icon tile + fullname + link Moodle */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconTile
            icon={AcademicCapIcon}
            size="lg"
            variant={dimmed ? "muted" : "accent"}
          />
          <div className="min-w-0">
            <div className="font-semibold text-foreground">{c.fullname}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <StatusBadge status="neutral" className="font-mono text-[10px]">
                {c.platform.key}
              </StatusBadge>
              <StatusBadge
                status="neutral"
                className="bg-muted font-mono text-[10px]"
              >
                {c.shortname}
              </StatusBadge>
            </div>
          </div>
        </div>
        <a
          href={courseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs text-primary hover:underline"
          title="Ouvrir le cours dans Moodle"
        >
          Moodle ↗
        </a>
      </div>

      {/* Mini-stats — 3 colonnes */}
      <div className="grid grid-cols-3 gap-2">
        <MiniStat
          icon={ChatBubbleOvalLeftEllipsisIcon}
          value={c._count.rooms}
          label={c._count.rooms > 1 ? "Salons" : "Salon"}
        />
        <MiniStat
          icon={CpuChipIcon}
          value={allAgents.size}
          label={allAgents.size > 1 ? "Agents" : "Agent"}
        />
        <MiniStat
          icon={BookOpenIcon}
          value={c._count.resources}
          label={c._count.resources > 1 ? "Ressources" : "Ressource"}
        />
      </div>

      {/* Salon lié */}
      {firstRoom && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Salon lié
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {firstRoom.name ?? (
                <span className="italic text-muted-foreground">
                  (sans nom)
                </span>
              )}
            </span>
            {allAgents.size === 0 ? (
              <span className="shrink-0 text-xs italic text-muted-foreground">
                Pas d&apos;agent
              </span>
            ) : (
              <div className="flex shrink-0 flex-wrap gap-1">
                {[...allAgents].slice(0, 4).map((slug) => (
                  <StatusBadge
                    key={slug}
                    status="processed"
                    className="font-mono text-[10px]"
                  >
                    {slug}
                  </StatusBadge>
                ))}
                {allAgents.size > 4 && (
                  <StatusBadge status="neutral" className="text-[10px]">
                    +{allAgents.size - 4}
                  </StatusBadge>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer : bouton + flèche ronde */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <Link
          href="/agents"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <CpuChipIcon className="size-4" />
          Gérer mes agents
        </Link>
        {targetRoomId && (
          <Link
            href={`/rooms/${targetRoomId}`}
            aria-label="Ouvrir le salon lié"
            title="Ouvrir le salon lié"
            className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105"
          >
            <ArrowRightIcon className="size-4" />
          </Link>
        )}
      </div>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <Icon className="size-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <div className="text-lg font-bold leading-none">{value}</div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}
