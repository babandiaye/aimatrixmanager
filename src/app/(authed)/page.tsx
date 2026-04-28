import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Tableau de bord
        </h1>
        <p className="text-muted-foreground">
          Gestion des agents IA Matrix.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Agents actifs</CardTitle>
            <CardDescription>0 sur 0 configurés</CardDescription>
          </CardHeader>
          <CardContent>
            <StatusBadge status="published">opérationnel</StatusBadge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Salons surveillés</CardTitle>
            <CardDescription>0 salons assignés</CardDescription>
          </CardHeader>
          <CardContent>
            <StatusBadge status="processing">en attente</StatusBadge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Plateformes Moodle</CardTitle>
            <CardDescription>aucune configurée</CardDescription>
          </CardHeader>
          <CardContent>
            <StatusBadge status="unpublished">à configurer</StatusBadge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>État du système</CardTitle>
          <CardDescription>
            Phase initiale du projet — fondations posées.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <StatusBadge status="published">OK</StatusBadge>
            <span className="text-muted-foreground">Auth + DB + Redis</span>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status="error">à venir</StatusBadge>
            <span className="text-muted-foreground">
              Intégration Synapse / Moodle / Anthropic
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
