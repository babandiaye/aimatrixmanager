import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { canAny } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getServerName } from "@/lib/synapse-admin";
import { visibleLlmsFilter } from "@/lib/llm-access";
import type { UserRole } from "@prisma/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AgentForm } from "../../agent-form";


/** Configurations LLM visibles par cet utilisateur, pour le sélecteur. */
async function loadLlmChoices(role: UserRole, userId: string) {
  const [choices, me] = await Promise.all([
    prisma.llmConfig.findMany({
      where: { ...visibleLlmsFilter({ role, userId }), isActive: true },
      orderBy: [{ scope: "asc" }, { isDefault: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        provider: true,
        model: true,
        scope: true,
        isDefault: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { defaultLlmConfigId: true },
    }),
  ]);
  return { choices, defaultLlmConfigId: me?.defaultLlmConfigId ?? null };
}

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // ENSEIGNANT a agents.update-own (et seulement sur ses propres agents).
  // L'ownership précis est revérifié dans les server actions via
  // assertAgentEditable. Ici on filtre déjà l'accès à la page.
  if (!canAny(session.user.role, "agents.update", "agents.update-own")) {
    redirect("/agents");
  }

  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) notFound();

  // ENSEIGNANT : ne peut ouvrir l'édition que de ses propres agents
  if (
    session.user.role === "ENSEIGNANT" &&
    agent.createdById !== session.user.id
  ) {
    redirect("/agents");
  }

  const serverName = getServerName();
  const { choices, defaultLlmConfigId } = await loadLlmChoices(
    session.user.role,
    session.user.id,
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Modifier {agent.name}
        </h1>
        <p className="text-muted-foreground font-mono text-sm">
          {agent.matrixUserId}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Le slug Matrix est figé. Pour changer d&apos;identité, supprime
            puis recrée l&apos;agent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgentForm
            serverName={serverName}
            llmChoices={choices}
            defaultLlmConfigId={defaultLlmConfigId}
            initial={{
              id: agent.id,
              slug: agent.slug,
              name: agent.name,
              description: agent.description,
              systemPrompt: agent.systemPrompt,
              provider: agent.provider,
              model: agent.model,
              llmConfigId: agent.llmConfigId,
              maxTokens: agent.maxTokens,
              temperature: agent.temperature,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
