import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
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
import { buttonVariants } from "@/components/ui/button";
import { AuditFilters } from "./audit-filters";

const PAGE_SIZE = 25;

const PERIODS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: null,
} as const;
type PeriodKey = keyof typeof PERIODS;

function fmtTimestamp(d: Date): string {
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function excerpt(s: string | null, n = 80): string {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; agent?: string; period?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "audit.view")) redirect("/");

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const agentFilter = sp.agent && sp.agent !== "all" ? sp.agent : null;
  const periodKey: PeriodKey =
    sp.period && sp.period in PERIODS ? (sp.period as PeriodKey) : "7d";

  const where: Prisma.AuditLogWhereInput = {};
  if (agentFilter) where.agentId = agentFilter;
  const periodMs = PERIODS[periodKey];
  if (periodMs !== null) {
    where.createdAt = { gte: new Date(Date.now() - periodMs) };
  }

  const [total, logs, agents] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        agent: { select: { slug: true, name: true } },
        room: {
          select: { id: true, name: true, matrixRoomId: true },
        },
      },
    }),
    prisma.agent.findMany({
      select: { id: true, slug: true, name: true },
      orderBy: { slug: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Audit</h1>
        <p className="text-muted-foreground">
          Conversations entre les étudiants et les agents IA — avec coût et
          latence.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {total} entrée{total > 1 ? "s" : ""}
            {agentFilter && ` · agent filtré`}
            {periodKey !== "all" && ` · période ${periodKey}`}
          </CardTitle>
          <CardDescription>
            Une ligne = une question d&apos;un membre + la réponse de
            l&apos;agent. Clique sur une ligne pour voir le contenu complet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AuditFilters
            agents={agents}
            currentAgent={agentFilter}
            currentPeriod={periodKey}
          />

          {total === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Aucune conversation enregistrée pour cette période / ce filtre.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Date</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Sender</TableHead>
                    <TableHead>Question</TableHead>
                    <TableHead>Réponse</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Latence</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtTimestamp(l.createdAt)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status="processed"
                          className="font-mono text-[10px]"
                        >
                          @{l.agent.slug}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {l.senderMxid.split(":")[0]}
                      </TableCell>
                      <TableCell className="text-xs max-w-xs">
                        {excerpt(l.userMessage)}
                      </TableCell>
                      <TableCell className="text-xs max-w-xs">
                        {l.error ? (
                          <StatusBadge status="error">erreur</StatusBadge>
                        ) : (
                          excerpt(l.agentResponse)
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono">
                        {l.inputTokens ?? "—"}/{l.outputTokens ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono text-muted-foreground">
                        {l.latencyMs ? `${l.latencyMs}ms` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/audit/${l.id}`}
                          className={buttonVariants({
                            variant: "outline",
                            size: "sm",
                          })}
                        >
                          Voir
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
                hrefBase={(() => {
                  const params = new URLSearchParams();
                  if (agentFilter) params.set("agent", agentFilter);
                  if (periodKey !== "7d") params.set("period", periodKey);
                  const qs = params.toString();
                  return qs ? `/audit?${qs}` : "/audit";
                })()}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
