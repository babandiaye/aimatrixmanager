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
import { AgentForm } from "../../agent-form";

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "agents.update")) redirect("/agents");

  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) notFound();

  const serverName = process.env.MATRIX_SERVER_NAME ?? "matrix.example.com";

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
            initial={{
              id: agent.id,
              slug: agent.slug,
              name: agent.name,
              description: agent.description,
              systemPrompt: agent.systemPrompt,
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
