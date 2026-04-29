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
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PlusIcon } from "@heroicons/react/24/outline";
import { PlatformActions } from "./platform-actions";

export default async function MoodlePlatformsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "moodle.view")) redirect("/");

  const canCreate = can(session.user.role, "moodle.create");
  const canUpdate = can(session.user.role, "moodle.update");
  const canDelete = can(session.user.role, "moodle.delete");

  const platforms = await prisma.moodlePlatform.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { courses: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Plateformes Moodle
          </h1>
          <p className="text-muted-foreground">
            Instances Moodle reliées à AI Bot Manager (DISI, P11STN…).
          </p>
        </div>
        {canCreate && (
          <Link href="/moodle/new" className={buttonVariants({ size: "lg" })}>
            <PlusIcon className="size-4" />
            Ajouter une plateforme
          </Link>
        )}
      </div>

      {platforms.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Aucune plateforme configurée</CardTitle>
            <CardDescription>
              {canCreate
                ? "Clique sur « Ajouter une plateforme » pour démarrer."
                : "Demande à un administrateur d'ajouter une plateforme."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{platforms.length} plateforme(s)</CardTitle>
            <CardDescription>
              Le token Web Services n&apos;est jamais affiché — saisis-en un
              nouveau à l&apos;édition pour le remplacer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clé</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Cours</TableHead>
                  <TableHead>État</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {platforms.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs font-semibold">
                      {p.key}
                    </TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <a
                        href={p.baseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {p.baseUrl}
                      </a>
                    </TableCell>
                    <TableCell className="text-sm">
                      {p._count.courses}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={p.enabled ? "published" : "unpublished"}
                      >
                        {p.enabled ? "actif" : "désactivé"}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-right">
                      <PlatformActions
                        id={p.id}
                        enabled={p.enabled}
                        canUpdate={canUpdate}
                        canDelete={canDelete}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
