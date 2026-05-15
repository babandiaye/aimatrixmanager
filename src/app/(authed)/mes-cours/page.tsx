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

export default async function MesCoursPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Accessible aux ENSEIGNANT (scope perso) et ADMIN (vue globale).
  if (!canAny(session.user.role, "rooms.view", "rooms.view-own")) {
    redirect("/");
  }

  // Pour ENSEIGNANT : résoudre ses cours Moodle (1er accès = appels WS, ensuite cache 1h)
  // Pour ADMIN/MANAGER : tous les cours.
  const teacherCourseIds =
    session.user.role === "ENSEIGNANT"
      ? await resolveTeacherCourseIds(session.user.id)
      : null;

  const courses = await prisma.moodleCourse.findMany({
    where:
      teacherCourseIds !== null
        ? { id: { in: teacherCourseIds } }
        : undefined,
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
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Mes cours</h1>
        <p className="text-muted-foreground">
          {session.user.role === "ENSEIGNANT"
            ? "Les cours Moodle où tu es enseignant. Tu peux y affecter tes agents IA."
            : "Tous les cours Moodle synchronisés."}
        </p>
      </div>

      {courses.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Aucun cours trouvé</CardTitle>
            <CardDescription>
              {session.user.role === "ENSEIGNANT" ? (
                <>
                  Nous n&apos;avons trouvé aucun cours où tu es marqué comme
                  enseignant côté Moodle pour l&apos;email{" "}
                  <code>{session.user.email}</code>. Vérifications :
                  <ul className="mt-2 ml-4 list-disc text-xs">
                    <li>
                      Ton compte Keycloak utilise le même email que ton compte
                      Moodle ?
                    </li>
                    <li>
                      Tu as bien le rôle « Enseignant » (editingteacher) ou
                      « Enseignant non éditeur » (teacher) dans au moins un
                      cours Moodle ?
                    </li>
                    <li>
                      La plateforme Moodle est activée côté admin (
                      <code>/moodle</code>) ?
                    </li>
                  </ul>
                </>
              ) : (
                "Lance une synchronisation depuis /moodle."
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
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
      )}
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
