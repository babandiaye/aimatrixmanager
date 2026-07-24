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
import {
  AcademicCapIcon,
  ChatBubbleLeftRightIcon,
  CpuChipIcon,
} from "@heroicons/react/24/outline";
import { RefreshMyCoursesButton } from "./refresh-button";

export default async function MesCoursPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Accessible aux ENSEIGNANT (scope perso) et ADMIN (vue globale).
  if (!canAny(session.user.role, "rooms.view", "rooms.view-own")) {
    redirect("/");
  }

  // Résout le scope Moodle "cours où je suis enseignant/tuteur" pour tous
  // les rôles aibotmanager (ADMIN inclus — un admin technique peut être
  // enseignant côté Moodle et vouloir gérer ses agents pour ses propres
  // cours). Cache 1h dans User.moodleUserMap. Pour vider ce cache :
  // bouton "Rafraîchir depuis Moodle" en haut de la page.
  const teacherCourseIds = await resolveTeacherCourseIds(session.user.id);

  // Timestamp de la dernière sync — affiché en petit dans le header pour
  // que l'user sache si sa vue est fraîche ou pas.
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { lastMoodleSyncAt: true },
  });
  const lastSync = me?.lastMoodleSyncAt;

  const courses =
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

  // Sépare les cours qui ont au moins un salon Matrix lié (source=MOODLE)
  // de ceux qui n'en ont pas — présentation en deux blocs distincts pour
  // que l'enseignant repère immédiatement où l'IA est déjà exploitable.
  const coursesWithRoom = courses.filter((c) => c._count.rooms > 0);
  const coursesWithoutRoom = courses.filter((c) => c._count.rooms === 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Mes cours</h1>
          <p className="text-muted-foreground">
            Les cours Moodle où tu es enseignant, tuteur ou tuteur suivi. Tu
            peux affecter tes agents IA aux salons Matrix liés.
          </p>
          {lastSync && (
            <p className="mt-1 text-xs text-muted-foreground">
              Dernière synchronisation Moodle :{" "}
              {lastSync.toLocaleString("fr-FR")}
            </p>
          )}
        </div>
        <RefreshMyCoursesButton />
      </div>

      {courses.length === 0 ? (
        <Card>
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
                  <strong>Rafraîchir depuis Moodle</strong> en haut à droite) ?
                </li>
              </ul>
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {coursesWithRoom.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Cours avec activité Matrix ({coursesWithRoom.length})
                </h2>
                <p className="text-sm text-muted-foreground">
                  Ces cours ont au moins un salon Matrix lié — tu peux y
                  affecter un agent IA depuis <code>/rooms</code>.
                </p>
              </div>
              <CourseGrid courses={coursesWithRoom} />
            </section>
          )}
          {coursesWithoutRoom.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-muted-foreground">
                  Cours sans activité Matrix ({coursesWithoutRoom.length})
                </h2>
                <p className="text-sm text-muted-foreground">
                  Aucun salon Matrix n&apos;est encore lié. Un enseignant peut
                  créer une activité <code>mod_matrix</code> côté Moodle, puis
                  cliquer sur <strong>Rafraîchir depuis Moodle</strong>.
                </p>
              </div>
              <CourseGrid courses={coursesWithoutRoom} dimmed />
            </section>
          )}
        </>
      )}

    </div>
  );
}

/**
 * Grille responsive de cards de cours. `dimmed` opacifie légèrement le bloc
 * pour signaler visuellement que ces cours n'ont pas encore d'activité Matrix
 * — l'utilisateur les voit mais comprend qu'ils ne sont pas "actionnables"
 * côté aibotmanager.
 */
function CourseGrid({
  courses,
  dimmed = false,
}: {
  courses: Array<{
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
  }>;
  dimmed?: boolean;
}) {
  return (
    <div
      className={`grid gap-4 md:grid-cols-2 ${dimmed ? "opacity-70" : ""}`}
    >
      {courses.map((c) => {
            const allAgents = new Set<string>();
            for (const r of c.rooms) {
              for (const a of r.assignments) allAgents.add(a.agent.slug);
            }
            const courseUrl = `${c.platform.baseUrl}/course/view.php?id=${c.moodleId}`;
            return (
              <Card key={c.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">{c.fullname}</CardTitle>
                      <CardDescription className="flex items-center gap-2 text-xs">
                        <StatusBadge status="neutral" className="font-mono">
                          {c.platform.key}
                        </StatusBadge>
                        <span className="font-mono">{c.shortname}</span>
                      </CardDescription>
                    </div>
                    <a
                      href={courseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                      title="Ouvrir le cours dans Moodle"
                    >
                      Moodle ↗
                    </a>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <Stat
                      icon={ChatBubbleLeftRightIcon}
                      label="Salons"
                      value={c._count.rooms}
                    />
                    <Stat
                      icon={CpuChipIcon}
                      label="Agents"
                      value={allAgents.size}
                    />
                    <Stat
                      icon={AcademicCapIcon}
                      label="Ressources"
                      value={c._count.resources}
                    />
                  </div>

                  {c.rooms.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Salons liés
                      </div>
                      <div className="space-y-1.5">
                        {c.rooms.map((r) => (
                          <Link
                            key={r.id}
                            href={`/rooms/${r.id}`}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted/30"
                          >
                            <span className="font-medium truncate">
                              {r.name ?? (
                                <span className="italic text-muted-foreground">
                                  (sans nom)
                                </span>
                              )}
                            </span>
                            <div className="flex shrink-0 gap-1">
                              {r.assignments.length === 0 ? (
                                <span className="text-muted-foreground">
                                  pas d&apos;agent
                                </span>
                              ) : (
                                r.assignments.map((a) => (
                                  <StatusBadge
                                    key={a.agent.slug}
                                    status="processed"
                                    className="font-mono text-[10px]"
                                  >
                                    {a.agent.slug}
                                  </StatusBadge>
                                ))
                              )}
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-2">
                    <Link
                      href="/agents"
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      Gérer mes agents
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-border p-2">
      <Icon className="mx-auto size-4 text-muted-foreground" />
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
