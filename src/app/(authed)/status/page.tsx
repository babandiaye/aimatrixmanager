import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSystemHealth, type HealthItem } from "@/lib/health";
import { isOllamaConfigured, listOllamaModels } from "@/lib/ollama";
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
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  CpuChipIcon,
} from "@heroicons/react/24/outline";

/**
 * Page /status — état détaillé des services externes.
 *
 * Différent de /dashboard qui donne juste un résumé : ici on affiche la
 * liste complète des modèles Ollama disponibles ET on croise avec les
 * modèles utilisés par les agents pour signaler ceux qui ont un modèle
 * disparu du serveur.
 */
export default async function StatusPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Tout ce qui est nécessaire, en parallèle. Chaque appel a son propre
  // timeout / gestion d'erreur interne — pas de try/catch global.
  const [health, ollamaModels, agents] = await Promise.all([
    getSystemHealth(),
    isOllamaConfigured() ? listOllamaModels() : Promise.resolve([]),
    prisma.agent.findMany({
      where: { provider: "OLLAMA" },
      select: {
        id: true,
        slug: true,
        name: true,
        model: true,
        status: true,
      },
      orderBy: { slug: "asc" },
    }),
  ]);

  const availableModelNames = new Set(ollamaModels.map((m) => m.name));
  const agentsWithMissingModel = agents.filter(
    (a) => !availableModelNames.has(a.model),
  );

  // Pour chaque modèle Ollama, on calcule combien d'agents l'utilisent.
  const usageByModel = new Map<string, number>();
  for (const a of agents) {
    usageByModel.set(a.model, (usageByModel.get(a.model) ?? 0) + 1);
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          État des services
        </h1>
        <p className="text-muted-foreground">
          Snapshot temps réel des composants dont dépend AI Bot Manager.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Services</CardTitle>
          <CardDescription>
            État calculé à la demande — chaque check a un timeout court
            (2,5 s) pour ne pas bloquer la page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {health.map((h) => (
              <li
                key={h.key}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="flex items-center gap-3">
                  <StatusIcon status={h.status} />
                  <div>
                    <div className="text-sm font-medium">{h.label}</div>
                    {h.detail && (
                      <div className="text-xs text-muted-foreground">
                        {h.detail}
                      </div>
                    )}
                  </div>
                </div>
                <StatusLabel status={h.status} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Modèles Ollama disponibles ({ollamaModels.length})
          </CardTitle>
          <CardDescription>
            Modèles présents sur le serveur d&apos;inférence configuré
            (variable <code>OLLAMA_BASE_URL</code>). Les agents affectés
            comptés incluent tous les statuts (ENABLED, DISABLED,
            SUSPENDED).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isOllamaConfigured() ? (
            <p className="text-sm text-muted-foreground">
              Ollama non configuré — variables{" "}
              <code>OLLAMA_BASE_URL</code> et <code>OLLAMA_API_KEY</code>{" "}
              absentes du <code>.env</code>.
            </p>
          ) : ollamaModels.length === 0 ? (
            <p className="text-sm text-status-error">
              Aucun modèle visible. Le serveur est joignable (sinon
              l&apos;état ci-dessus serait en erreur) mais renvoie une
              liste vide — probablement un redémarrage récent ou un
              problème côté fromager.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Famille</TableHead>
                  <TableHead>Taille param.</TableHead>
                  <TableHead>Taille disque</TableHead>
                  <TableHead className="text-right">
                    Agents affectés
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ollamaModels.map((m) => (
                  <TableRow key={m.name}>
                    <TableCell className="font-mono text-xs">
                      {m.name}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.family ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {m.parameter_size ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatBytes(m.size)}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {usageByModel.get(m.name) ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {agentsWithMissingModel.length > 0 && (
        <Card className="border-status-error/40 bg-status-error/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-status-error">
              <ExclamationTriangleIcon className="size-5" />
              Agents utilisant un modèle non disponible (
              {agentsWithMissingModel.length}/{agents.length})
            </CardTitle>
            <CardDescription>
              Ces agents Ollama pointent vers un modèle absent du serveur.
              Ils tomberont en erreur au premier message. Change leur
              modèle depuis la page de chaque agent, ou fais charger le
              modèle sur fromager.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Modèle demandé</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentsWithMissingModel.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <CpuChipIcon className="size-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium">{a.name}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            @{a.slug}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-status-error">
                      {a.model}
                    </TableCell>
                    <TableCell className="text-xs">{a.status}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/agents/${a.id}/edit`}
                        className="text-xs text-primary hover:underline"
                      >
                        Modifier ↗
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: HealthItem["status"] }) {
  if (status === "ok")
    return <CheckCircleIcon className="size-5 text-status-published" />;
  if (status === "warn")
    return <ExclamationTriangleIcon className="size-5 text-status-unpublished" />;
  return <XCircleIcon className="size-5 text-status-error" />;
}

function StatusLabel({ status }: { status: HealthItem["status"] }) {
  const label =
    status === "ok" ? "OK" : status === "warn" ? "Dégradé" : "Erreur";
  const color =
    status === "ok"
      ? "text-status-published"
      : status === "warn"
        ? "text-status-unpublished"
        : "text-status-error";
  return <span className={`text-xs font-medium ${color}`}>{label}</span>;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} MB`;
}
