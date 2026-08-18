import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/permissions";
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
import { AgentForm } from "../agent-form";


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

export default async function NewAgentPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "agents.create")) redirect("/agents");

  const serverName = getServerName();
  const { choices, defaultLlmConfigId } = await loadLlmChoices(
    session.user.role,
    session.user.id,
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Nouvel agent</h1>
        <p className="text-muted-foreground">
          La création provisionne un compte Matrix dédié et stocke un token
          d&apos;accès chiffré pour piloter le bot.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Tous les champs marqués <span className="text-destructive">*</span>{" "}
            sont requis. L&apos;agent est créé en statut{" "}
            <code>DISABLED</code> — tu peux l&apos;activer après l&apos;avoir
            assigné à des salons.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgentForm
            serverName={serverName}
            llmChoices={choices}
            defaultLlmConfigId={defaultLlmConfigId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
