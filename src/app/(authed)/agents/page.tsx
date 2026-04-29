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
  PlusIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
} from "@heroicons/react/24/outline";
import { AgentRowActions } from "./row-actions";

const PAGE_SIZE = 10;

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "agents.view")) redirect("/");

  const canCreate = can(session.user.role, "agents.create");
  const canUpdate = can(session.user.role, "agents.update");
  const canDelete = can(session.user.role, "agents.delete");

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const [total, agents] = await Promise.all([
    prisma.agent.count(),
    prisma.agent.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        _count: { select: { assignments: true } },
        crossSigning: {
          select: { signedDeviceId: true, masterPubKey: true },
        },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Agents IA
          </h1>
          <p className="text-muted-foreground">
            Bots Matrix pilotés par Claude. Chaque agent a un compte Matrix
            et un prompt système propres.
          </p>
        </div>
        {canCreate && (
          <Link href="/agents/new" className={buttonVariants({ size: "lg" })}>
            <PlusIcon className="size-4" />
            Nouvel agent
          </Link>
        )}
      </div>

      {total === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Aucun agent configuré</CardTitle>
            <CardDescription>
              {canCreate
                ? "Crée un premier agent pour démarrer."
                : "Demande à un manager d'ajouter un agent."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {total} agent{total > 1 ? "s" : ""}
            </CardTitle>
            <CardDescription>
              Le statut <code>ENABLED</code> permet à l&apos;agent de
              répondre dans ses salons.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slug</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Modèle</TableHead>
                  <TableHead>Salons</TableHead>
                  <TableHead>E2EE</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((a) => {
                  const xs = a.crossSigning;
                  const xsState: "verified" | "partial" | "missing" = !xs
                    ? "missing"
                    : xs.signedDeviceId === a.matrixDeviceId
                      ? "verified"
                      : "partial";
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs">
                        <div>{a.slug}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {a.matrixUserId}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>{a.name}</div>
                        {a.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {a.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {a.model}
                      </TableCell>
                      <TableCell className="text-sm">
                        {a._count.assignments}
                      </TableCell>
                      <TableCell>
                        {xsState === "verified" ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-status-published"
                            title="Master + SSK uploadées, device signé. Plus de bouclier rouge dans Element."
                          >
                            <ShieldCheckIcon className="size-3.5" />
                            Vérifié
                          </span>
                        ) : xsState === "partial" ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-status-unpublished"
                            title="Master uploadée, mais le device courant n'est pas encore signé par SSK. Clique sur 'Signer device'."
                          >
                            <ShieldExclamationIcon className="size-3.5" />
                            Partiel
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                            title="Pas de cross-signing — bouclier rouge sur les messages. Lance 'Régénérer token' pour activer."
                          >
                            <ShieldExclamationIcon className="size-3.5" />
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={
                            a.status === "ENABLED"
                              ? "published"
                              : a.status === "SUSPENDED"
                                ? "error"
                                : "unpublished"
                          }
                        >
                          {a.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-right">
                        <AgentRowActions
                          id={a.id}
                          slug={a.slug}
                          name={a.name}
                          status={a.status}
                          canUpdate={canUpdate}
                          canDelete={canDelete}
                          xsState={xsState}
                        />
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
              hrefBase="/agents"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
