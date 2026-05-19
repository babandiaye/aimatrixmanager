import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { canAny } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isOllamaConfigured, listOllamaModels } from "@/lib/ollama";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AgentForm } from "../../agent-form";

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

  const serverName = process.env.MATRIX_SERVER_NAME ?? "matrix.example.com";
  const ollamaEnabled = isOllamaConfigured();
  const ollamaModels = ollamaEnabled ? await listOllamaModels() : [];

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
            ollamaModels={ollamaModels}
            ollamaEnabled={ollamaEnabled}
            initial={{
              id: agent.id,
              slug: agent.slug,
              name: agent.name,
              description: agent.description,
              systemPrompt: agent.systemPrompt,
              provider: agent.provider,
              model: agent.model,
              maxTokens: agent.maxTokens,
              temperature: agent.temperature,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
