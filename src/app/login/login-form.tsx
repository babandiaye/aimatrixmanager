"use client";

import { useActionState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { loginWithCredentials } from "./actions";

/**
 * Formulaire local — affiché uniquement si Keycloak n'est pas configuré
 * OU si on est en mode urgence (EMERGENCY_LOCAL_LOGIN=1) avec ?manual=1.
 */
export function LoginForm({
  emergency,
  keycloakConfigured,
  error: ssoError,
}: {
  emergency: boolean;
  keycloakConfigured: boolean;
  error?: string;
}) {
  const [state, formAction, pending] = useActionState(
    loginWithCredentials,
    undefined,
  );

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">AI Bot Manager</CardTitle>
        <CardDescription>
          {emergency
            ? "Mode urgence — connexion locale activée"
            : "Connexion locale (Keycloak non configuré)"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {emergency && (
          <div className="flex items-start gap-2 rounded-lg border border-status-unpublished/30 bg-status-unpublished/5 p-3 text-xs">
            <ExclamationTriangleIcon className="size-4 shrink-0 text-status-unpublished" />
            <p>
              <strong>EMERGENCY_LOCAL_LOGIN actif.</strong> À désactiver dès que
              Keycloak est rétabli (retirer la var de <code>.env</code> et
              redémarrer).
            </p>
          </div>
        )}

        {ssoError && (
          <div className="rounded-lg bg-status-error/10 p-3 text-sm text-status-error">
            Échec de la connexion SSO ({ssoError}). Réessaie ou contacte un
            administrateur.
          </div>
        )}

        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="admin@unchk.sn"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Connexion..." : "Se connecter"}
          </Button>
        </form>

        {keycloakConfigured && emergency && (
          <p className="text-center text-xs text-muted-foreground">
            <a href="/login" className="text-primary hover:underline">
              ← Revenir à la connexion Keycloak
            </a>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
