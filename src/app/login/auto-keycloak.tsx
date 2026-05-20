"use client";

import { loginWithKeycloak } from "./actions";

/**
 * Vue affichée *uniquement* quand on ne peut pas auto-rediriger vers
 * Keycloak côté serveur (cas erreur SSO ou ?logged_out=1).
 *
 * Le cas nominal (pas d'erreur, pas de post-logout) est intercepté en
 * amont dans `page.tsx` qui appelle `signIn("keycloak")` côté serveur →
 * redirect HTTP direct, aucune page HTML rendue.
 */
export function AutoKeycloak({
  error,
  loggedOut = false,
}: {
  error?: string;
  loggedOut?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-unchk.png" alt="UN-CHK" className="h-12 w-auto" />

      {error && (
        <div className="max-w-md rounded-lg bg-status-error/10 p-4 text-sm text-status-error">
          Échec de la connexion SSO ({error}). Vérifie que Keycloak est joignable
          ou contacte un administrateur.
        </div>
      )}

      {loggedOut && !error && (
        <p className="text-sm text-muted-foreground">Tu as été déconnecté.</p>
      )}

      <form action={loginWithKeycloak}>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
        >
          {error ? "Réessayer" : loggedOut ? "Se reconnecter" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
