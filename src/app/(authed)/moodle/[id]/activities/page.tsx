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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Pagination } from "@/components/ui/pagination";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { SyncActivitiesButton } from "./sync-button";

type RoomEntry = {
  matrix_room_id: string;
  group_id: number | null;
  timecreated: number;
};

const PAGE_SIZE = 20;

export default async function MatrixActivitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "moodle.view")) redirect("/");

  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const platform = await prisma.moodlePlatform.findUnique({ where: { id } });
  if (!platform) notFound();

  const canSync = can(session.user.role, "rooms.assign");

  const [total, activities] = await Promise.all([
    prisma.moodleMatrixActivity.count({ where: { platformId: id } }),
    prisma.moodleMatrixActivity.findMany({
      where: { platformId: id },
      orderBy: [{ courseFullname: "asc" }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/moodle"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Retour aux plateformes
          </Link>
          <h1 className="text-2xl font-semibold text-foreground">
            Activités <code className="text-base">mod_matrix</code> —{" "}
            {platform.name}
          </h1>
          <p className="text-muted-foreground">
            Instances du plugin Famedly <code>mod_matrix</code> détectées sur
            cette plateforme. Chaque activité crée un (ou plusieurs) salon(s)
            Matrix pour son cours.
          </p>
        </div>
        {canSync && platform.enabled && (
          <SyncActivitiesButton platformId={id} />
        )}
      </div>

      {total === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Aucune activité Matrix détectée</CardTitle>
            <CardDescription>
              Lance la synchronisation pour interroger Moodle. Si la plateforme
              ne renvoie rien, vérifie qu&apos;au moins un cours utilise le
              plugin <code>mod_matrix</code> et que le compte service a accès
              aux cours concernés.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{total} activité(s)</CardTitle>
            <CardDescription>
              Cliquer sur l&apos;icône pour ouvrir l&apos;activité directement
              dans Moodle.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cours</TableHead>
                  <TableHead>Activité</TableHead>
                  <TableHead>Salons Matrix</TableHead>
                  <TableHead>Provisionné</TableHead>
                  <TableHead>Créée le</TableHead>
                  <TableHead className="text-right">Lien Moodle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activities.map((a) => {
                  const rooms = a.rooms as unknown as RoomEntry[];
                  const provisioned = rooms.filter(
                    (r) => r.matrix_room_id && r.matrix_room_id.length > 0,
                  ).length;
                  const allProvisioned =
                    rooms.length > 0 && provisioned === rooms.length;
                  const partial = provisioned > 0 && !allProvisioned;
                  const deepLink = `${platform.baseUrl}/mod/matrix/view.php?id=${a.courseModuleId}`;
                  const courseLink = `${platform.baseUrl}/course/view.php?id=${a.moodleCourseId}`;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <a
                          href={courseLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                          title={a.courseFullname}
                        >
                          <div className="font-medium text-foreground">
                            {a.courseShortname}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {a.courseFullname}
                          </div>
                        </a>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{a.name}</div>
                        {a.topic && (
                          <div className="text-xs text-muted-foreground">
                            {a.topic}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {rooms.length}{" "}
                          {rooms.some((r) => r.group_id !== null) && (
                            <span className="text-xs text-muted-foreground">
                              (par groupe)
                            </span>
                          )}
                        </div>
                        <div className="space-y-0.5">
                          {rooms.slice(0, 3).map((r, i) => (
                            <div
                              key={i}
                              className="font-mono text-[10px] text-muted-foreground"
                            >
                              {r.matrix_room_id || "(non provisionné)"}
                              {r.group_id !== null && ` · grp ${r.group_id}`}
                            </div>
                          ))}
                          {rooms.length > 3 && (
                            <div className="text-[10px] text-muted-foreground">
                              … +{rooms.length - 3}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={
                            allProvisioned
                              ? "published"
                              : partial
                                ? "unpublished"
                                : "neutral"
                          }
                        >
                          {allProvisioned
                            ? "OK"
                            : partial
                              ? `${provisioned}/${rooms.length}`
                              : "en attente"}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.timecreated.toLocaleDateString("fr-FR")}
                      </TableCell>
                      <TableCell className="text-right">
                        <a
                          href={deepLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          Ouvrir ↗
                        </a>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              hrefBase={`/moodle/${id}/activities`}
              className="mt-4"
            />
          </CardContent>
        </Card>
      )}

    </div>
  );
}
