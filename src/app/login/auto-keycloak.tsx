"use client";

import { useEffect, useRef } from "react";
import { loginWithKeycloak } from "./actions";

/**
 * Soumet automatiquement un form qui appelle l'action serveur signIn("keycloak").
 * On évite le GET vers /api/auth/signin/keycloak (qui en NextAuth v5 ne lance
 * pas le flow OAuth — il faut un POST avec CSRF).
 */
export function AutoKeycloak({
  emergency = false,
  error,
}: {
  emergency?: boolean;
  error?: string;
}) {
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // Si on revient ici avec une erreur, on n'auto-submit pas — sinon boucle.
    if (error) return;
    ref.current?.requestSubmit();
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-unchk.png" alt="UN-CHK" className="h-12 w-auto" />
      {error ? (
        <div className="max-w-md rounded-lg bg-status-error/10 p-4 text-sm text-status-error">
          Échec de la connexion SSO ({error}). Vérifie que Keycloak est joignable
          ou contacte un administrateur.
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Redirection vers Keycloak UNCHK...
        </p>
      )}
      <form ref={ref} action={loginWithKeycloak}>
        <button
          type="submit"
          className="text-xs text-primary underline-offset-2 hover:underline"
        >
          {error
            ? "Réessayer"
            : "Cliquer ici si la redirection ne se fait pas automatiquement"}
        </button>
      </form>
      {emergency && (
        <a
          href="/login?manual=1"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Connexion d'urgence (locale)
        </a>
      )}
    </div>
  );
}
