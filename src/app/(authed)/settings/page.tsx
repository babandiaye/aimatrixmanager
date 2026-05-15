import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/permissions";
import { isKeycloakConfigured } from "@/lib/auth-config";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "settings.manage")) redirect("/");

  const keycloakConfigured = isKeycloakConfigured();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Paramètres</h1>
        <p className="text-muted-foreground">
          Configuration générale d&apos;AI Bot Manager.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Authentification</CardTitle>
          <CardDescription>
            AI Bot Manager utilise <strong>Keycloak UNCHK</strong> comme unique
            fournisseur d&apos;identité. Les rôles sont gérés en base après la
            première connexion (le tout premier utilisateur est promu
            automatiquement <code>ADMIN</code>, les suivants arrivent en{" "}
            <code>AUDITOR</code>).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Connecteur Keycloak</span>
                {keycloakConfigured ? (
                  <StatusBadge status="published">configuré</StatusBadge>
                ) : (
                  <StatusBadge status="error">non configuré</StatusBadge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {keycloakConfigured
                  ? `Issuer : ${process.env.KEYCLOAK_ISSUER}`
                  : "Définis KEYCLOAK_ISSUER, KEYCLOAK_CLIENT_ID et KEYCLOAK_CLIENT_SECRET dans .env, puis redémarre le service."}
              </p>
            </div>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
