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
import { StatusBadge } from "@/components/ui/status-badge";
import { Pagination } from "@/components/ui/pagination";
import { UserActions } from "./user-actions";
import { PageHeader } from "@/components/ui/page-header";
import { UserGroupIcon } from "@heroicons/react/24/outline";

const PAGE_SIZE = 20;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "users.manage")) redirect("/");

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const [total, adminCount, users] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        accounts: { select: { provider: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UserGroupIcon}
        title="Utilisateurs"
        description="Comptes ayant accès à AI Bot Manager."
      />

      <Card>
        <CardHeader>
          <CardTitle>{total} compte(s)</CardTitle>
          <CardDescription>
            Les comptes Keycloak sont créés automatiquement à la première
            connexion (rôle <code>ENSEIGNANT</code> par défaut, filtre
            d&apos;affiliation appliqué côté Keycloak/UN-CHK).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Nom</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Créé le</TableHead>
                <TableHead>Dernière connexion</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const isSelf = u.id === session.user.id;
                const isLastAdmin = u.role === "ADMIN" && adminCount <= 1;
                const providers = u.accounts.length
                  ? u.accounts.map((a) => a.provider).join(", ")
                  : "—";
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-mono text-xs">
                      {u.email}
                      {isSelf && (
                        <StatusBadge status="processing" className="ml-2">
                          toi
                        </StatusBadge>
                      )}
                    </TableCell>
                    <TableCell>{u.name ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge
                        status={
                          u.role === "ADMIN"
                            ? "published"
                            : u.role === "MANAGER"
                              ? "processed"
                              : u.role === "ENSEIGNANT"
                                ? "processing"
                                : "neutral"
                        }
                      >
                        {u.role}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {providers}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.createdAt.toLocaleDateString("fr-FR")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.lastLoginAt ? (
                        <div className="space-y-0.5">
                          <div>
                            {u.lastLoginAt.toLocaleString("fr-FR", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </div>
                          {u.lastLoginIp && (
                            <div className="font-mono text-[10px]">
                              {u.lastLoginIp}
                            </div>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <UserActions
                        userId={u.id}
                        currentRole={u.role}
                        isSelf={isSelf}
                        isLastAdmin={isLastAdmin}
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
            hrefBase="/users"
            className="mt-4"
          />
        </CardContent>
      </Card>
    </div>
  );
}
