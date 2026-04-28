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
import { StatusBadge } from "@/components/ui/status-badge";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";
import { DeleteAuditButton } from "./delete-button";

function fmt(d: Date): string {
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "audit.view")) redirect("/");

  const canDelete = can(session.user.role, "audit.delete");
  const { id } = await params;

  const log = await prisma.auditLog.findUnique({
    where: { id },
    include: {
      agent: { select: { slug: true, name: true, model: true } },
      room: { select: { id: true, name: true, matrixRoomId: true } },
    },
  });
  if (!log) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/audit"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Retour à l&apos;audit
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Conversation {log.id.slice(-12)}
          </h1>
          <p className="text-muted-foreground text-sm">
            {fmt(log.createdAt)}
          </p>
        </div>
        {canDelete && <DeleteAuditButton id={log.id} />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Métadonnées</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-3">
          <div>
            <div className="text-xs uppercase text-muted-foreground tracking-wider">
              Agent
            </div>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge
                status="processed"
                className="font-mono text-[10px]"
              >
                @{log.agent.slug}
              </StatusBadge>
              <span>{log.agent.name}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              modèle : <span className="font-mono">{log.agent.model}</span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground tracking-wider">
              Salon
            </div>
            <div className="mt-1">
              <Link
                href={`/rooms/${log.room.id}`}
                className="text-primary hover:underline"
              >
                {log.room.name ?? "(sans nom)"}
              </Link>
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {log.room.matrixRoomId}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground tracking-wider">
              Sender
            </div>
            <div className="mt-1 font-mono text-xs">{log.senderMxid}</div>
          </div>

          <div>
            <div className="text-xs uppercase text-muted-foreground tracking-wider">
              Tokens
            </div>
            <div className="mt-1 font-mono text-xs">
              in <span className="text-foreground">{log.inputTokens ?? "—"}</span>
              {" · "}
              out <span className="text-foreground">{log.outputTokens ?? "—"}</span>
              {" · "}
              cache_read{" "}
              <span className="text-foreground">{log.cacheReadTokens ?? "—"}</span>
              {" · "}
              cache_write{" "}
              <span className="text-foreground">{log.cacheWriteTokens ?? "—"}</span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground tracking-wider">
              Latence
            </div>
            <div className="mt-1 font-mono text-xs">
              {log.latencyMs ? `${log.latencyMs} ms` : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground tracking-wider">
              Event Matrix
            </div>
            <div className="mt-1 font-mono text-[10px] break-all">
              {log.matrixEventId ?? "—"}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Question</CardTitle>
          <CardDescription>
            Message envoyé par {log.senderMxid} (mention de l&apos;agent
            retirée).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap font-sans text-sm rounded-lg bg-muted p-4">
            {log.userMessage}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Réponse de l&apos;agent</CardTitle>
        </CardHeader>
        <CardContent>
          {log.error ? (
            <div className="space-y-2">
              <StatusBadge status="error">erreur</StatusBadge>
              <pre className="whitespace-pre-wrap font-mono text-xs rounded-lg bg-status-error/10 p-4 text-status-error">
                {log.error}
              </pre>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm rounded-lg bg-muted p-4">
              {log.agentResponse ?? "(pas de réponse)"}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
