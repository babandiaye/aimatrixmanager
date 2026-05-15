"use client";

import { useEffect, useRef } from "react";
import { loginWithKeycloak } from "./actions";

/**
 * Page de connexion 100% Keycloak.
 *
 * - Cas nominal : on auto-submit immédiatement le form vers Keycloak (SSO).
 * - Cas erreur : on n'auto-submit pas (sinon boucle), on affiche un message.
 * - Cas post-logout (?logged_out=1) : on n'auto-submit pas pour laisser
 *   l'utilisateur cliquer manuellement (sinon il est immédiatement renvoyé
 *   sur sa session SSO encore active, ce qui annule le logout perçu).
 */
export function AutoKeycloak({
  error,
  loggedOut = false,
}: {
  error?: string;
  loggedOut?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (error || loggedOut) return;
    ref.current?.requestSubmit();
  }, [error, loggedOut]);

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
        <p className="text-sm text-muted-foreground">
          Tu as été déconnecté.
        </p>
      )}

      {!error && !loggedOut && (
        <p className="text-sm text-muted-foreground">
          Redirection vers Keycloak UN-CHK…
        </p>
      )}

      <form ref={ref} action={loginWithKeycloak}>
        <button
          type="submit"
          className="text-xs text-primary underline-offset-2 hover:underline"
        >
          {error
            ? "Réessayer"
            : loggedOut
              ? "Se reconnecter"
              : "Cliquer ici si la redirection ne se fait pas automatiquement"}
        </button>
      </form>
    </div>
  );
}
