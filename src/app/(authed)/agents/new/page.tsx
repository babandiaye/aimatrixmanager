import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/permissions";
import { isOllamaConfigured, listOllamaModels } from "@/lib/ollama";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AgentForm } from "../agent-form";

export default async function NewAgentPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "agents.create")) redirect("/agents");

  const serverName = process.env.MATRIX_SERVER_NAME ?? "matrix.example.com";
  const ollamaEnabled = isOllamaConfigured();
  const ollamaModels = ollamaEnabled ? await listOllamaModels() : [];

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
            ollamaModels={ollamaModels}
            ollamaEnabled={ollamaEnabled}
          />
        </CardContent>
      </Card>
    </div>
  );
}
