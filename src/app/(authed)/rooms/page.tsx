import Link from "next/link";
import { redirect } from "next/navigation";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Pagination } from "@/components/ui/pagination";
import {
  LockClosedIcon,
  UsersIcon,
  AcademicCapIcon,
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
import { SyncRoomsButton } from "./sync-rooms-button";

const PAGE_SIZE = 20;

export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "rooms.view")) redirect("/");

  const canAssign = can(session.user.role, "rooms.assign");

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const [total, rooms] = await Promise.all([
    prisma.room.count(),
    prisma.room.findMany({
      orderBy: { discoveredAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        moodleCourse: {
          select: { shortname: true, platform: { select: { key: true } } },
        },
        assignments: {
          where: { enabled: true },
          select: { agent: { select: { slug: true } } },
        },
        _count: { select: { assignments: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Salons</h1>
          <p className="text-muted-foreground">
            Salons Matrix découverts depuis Synapse — assignation des agents
            et lien aux cours Moodle.
          </p>
        </div>
        {canAssign && <SyncRoomsButton />}
      </div>

      {total === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Aucun salon connu</CardTitle>
            <CardDescription>
              {canAssign
                ? "Clique sur « Synchroniser » pour importer les salons depuis Synapse."
                : "Demande à un manager de lancer la synchronisation."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {total} salon{total > 1 ? "s" : ""}
            </CardTitle>
            <CardDescription>
              Clique sur un salon pour gérer ses agents et son cours Moodle.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Membres</TableHead>
                  <TableHead>Agents</TableHead>
                  <TableHead>Cours Moodle</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rooms.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">
                        {r.name ?? (
                          <span className="text-muted-foreground italic">
                            (sans nom)
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {r.matrixRoomId}
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.source === "MOODLE" ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-status-published"
                          title="Provisionné via le plugin mod_matrix Moodle"
                        >
                          <AcademicCapIcon className="size-3.5" />
                          Moodle
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                          title="Créé nativement (Element, formation1-chat.unchk.sn…)"
                        >
                          <ChatBubbleLeftRightIcon className="size-3.5" />
                          Chat
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs">
                        {r.isDirect ? (
                          <span className="text-muted-foreground">DM</span>
                        ) : (
                          <span className="text-muted-foreground">Groupe</span>
                        )}
                        {r.isEncrypted && (
                          <LockClosedIcon
                            className="size-3.5 text-status-published"
                            aria-label="E2EE"
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1">
                        <UsersIcon className="size-3.5 text-muted-foreground" />
                        {/* On ne stocke pas le count en DB; futur : à syncer */}
                        —
                      </span>
                    </TableCell>
                    <TableCell>
                      {r.assignments.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          —
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.assignments.map((a) => (
                            <StatusBadge
                              key={a.agent.slug}
                              status="processed"
                              className="font-mono text-[10px]"
                            >
                              {a.agent.slug}
                            </StatusBadge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.moodleCourse ? (
                        <div className="text-xs">
                          <span className="font-mono">
                            [{r.moodleCourse.platform.key}]
                          </span>{" "}
                          {r.moodleCourse.shortname}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/rooms/${r.id}`}
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                        })}
                      >
                        Détails
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              hrefBase="/rooms"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
