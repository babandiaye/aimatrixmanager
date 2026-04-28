import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/permissions";
import { isKeycloakConfigured, SETTINGS_ID } from "@/lib/auth-config";
import { prisma } from "@/lib/prisma";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { KeycloakToggle } from "./keycloak-toggle";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "settings.manage")) redirect("/");

  const configured = isKeycloakConfigured();
  const settings = await prisma.systemSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
    select: { keycloakEnabled: true, updatedAt: true },
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Paramètres</h1>
        <p className="text-muted-foreground">
          Configuration générale d'aibotmanager.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Authentification Keycloak</CardTitle>
          <CardDescription>
            Active la connexion via Keycloak UNCHK. Quand activée, elle
            apparaît en bouton principal sur la page de connexion. La
            connexion locale par email/mot de passe reste disponible en
            secours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">État du connecteur</span>
                {!configured ? (
                  <StatusBadge status="error">non configuré (.env)</StatusBadge>
                ) : settings.keycloakEnabled ? (
                  <StatusBadge status="published">actif</StatusBadge>
                ) : (
                  <StatusBadge status="unpublished">désactivé</StatusBadge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {configured
                  ? `Issuer : ${process.env.KEYCLOAK_ISSUER}`
                  : "Définis KEYCLOAK_ISSUER, KEYCLOAK_CLIENT_ID et KEYCLOAK_CLIENT_SECRET dans .env, puis redémarre le service."}
              </p>
            </div>
            <KeycloakToggle
              enabled={settings.keycloakEnabled}
              disabled={!configured}
            />
          </div>

          {!configured && (
            <p className="text-xs text-muted-foreground">
              Le connecteur étant absent du <code>.env</code>, le toggle est
              inopérant et la connexion locale est la seule possible.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
