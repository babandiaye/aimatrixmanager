import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { canAny } from "@/lib/permissions";
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
  ArrowLeftIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";

/**
 * Vue détail d'un agent — lecture seule.
 *
 * Accessible à tous les rôles ayant `agents.view` (ADMIN/MANAGER/AUDITOR)
 * ou `agents.view-own` (ENSEIGNANT sur ses agents). Le bouton "Modifier"
 * apparaît uniquement si l'user a aussi `agents.update` ou
 * `agents.update-own` ET en est le créateur (cas ENSEIGNANT).
 */
export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAny(session.user.role, "agents.view", "agents.view-own")) {
    redirect("/");
  }

  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: {
      createdBy: { select: { email: true, name: true } },
      _count: { select: { assignments: { where: { enabled: true } } } },
      assignments: {
        where: { enabled: true },
        include: {
          room: {
            select: {
              id: true,
              name: true,
              matrixRoomId: true,
              isDirect: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!agent) notFound();

  // ENSEIGNANT : seulement ses propres agents (parano cohérent avec
  // l'édition).
  if (
    session.user.role === "ENSEIGNANT" &&
    agent.createdById !== session.user.id
  ) {
    redirect("/agents");
  }

  const canEdit =
    canAny(session.user.role, "agents.update", "agents.update-own") &&
    (session.user.role !== "ENSEIGNANT" ||
      agent.createdById === session.user.id);

  const heartbeatSec = agent.lastHeartbeatAt
    ? Math.floor(
        (Date.now() - new Date(agent.lastHeartbeatAt).getTime()) / 1000,
      )
    : null;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/agents"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Retour aux agents
          </Link>
          <h1 className="text-2xl font-semibold text-foreground">
            {agent.name}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">
            {agent.matrixUserId}
          </p>
        </div>
        {canEdit && (
          <Link
            href={`/agents/${agent.id}/edit`}
            className={buttonVariants({ size: "sm" })}
          >
            <PencilSquareIcon className="size-4" />
            Modifier
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identité &amp; statut</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Slug" mono>
            @{agent.slug}
          </Field>
          <Field label="Statut">
            <StatusBadge
              status={
                agent.status === "ENABLED"
                  ? "published"
                  : agent.status === "SUSPENDED"
                    ? "error"
                    : "unpublished"
              }
            >
              {agent.status}
            </StatusBadge>
          </Field>
          <Field label="Provider">{agent.provider}</Field>
          <Field label="Modèle" mono>
            {agent.model}
          </Field>
          <Field label="Max tokens">{agent.maxTokens}</Field>
          <Field label="Température">{agent.temperature ?? "—"}</Field>
          <Field label="Créé par">
            {agent.createdBy?.name ?? agent.createdBy?.email ?? "—"}
          </Field>
          <Field label="Créé le">
            {agent.createdAt.toLocaleString("fr-FR", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </Field>
          <Field label="Dernier heartbeat">
            {heartbeatSec === null
              ? "—"
              : heartbeatSec < 90
                ? `il y a ${heartbeatSec}s · en ligne`
                : `il y a ${Math.floor(heartbeatSec / 60)} min · hors ligne`}
          </Field>
          {agent.description && (
            <Field label="Description" full>
              <span className="text-sm">{agent.description}</span>
            </Field>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System prompt</CardTitle>
          <CardDescription>
            Instructions données à l&apos;agent à chaque conversation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-4 text-xs text-foreground">
            {agent.systemPrompt}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Salons assignés ({agent._count.assignments})
          </CardTitle>
          <CardDescription>
            Salons Matrix actifs où cet agent répond aux mentions. Les DMs
            (conversations directes) ne sont pas listés ici — l&apos;agent y
            répond automatiquement à tout interlocuteur.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {agent.assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun salon assigné.
            </p>
          ) : (
            <ul className="space-y-2">
              {agent.assignments.map((ra) => (
                <li
                  key={ra.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div>
                    <div className="text-sm font-medium">
                      {ra.room.name ?? "(sans nom)"}
                      {ra.room.isDirect && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (DM)
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {ra.room.matrixRoomId}
                    </div>
                  </div>
                  <Link
                    href={`/rooms/${ra.room.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Ouvrir ↗
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  children,
  mono,
  full,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 text-sm ${mono ? "font-mono" : ""} text-foreground`}
      >
        {children}
      </div>
    </div>
  );
}
