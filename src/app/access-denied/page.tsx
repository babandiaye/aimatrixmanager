import { Footer } from "@/components/footer";

/**
 * Page affichée quand Keycloak a authentifié l'user mais que le callback
 * signIn d'aibotmanager l'a refusé (affiliation insuffisante). La session
 * NextAuth N'EXISTE PAS (le rejet a court-circuité la création), mais la
 * session SSO Keycloak côté navigateur est encore active — d'où le bouton
 * « Retour » qui pointe vers `/api/auth/rejection-logout`, route handler
 * qui ferme la session Keycloak via backchannel puis redirige vers `/`.
 */
export default function AccessDeniedPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-aibotmanager.png"
            alt="AI Bot Manager"
            className="mx-auto h-20 w-auto"
          />

          <div className="space-y-3 text-center">
            <h1 className="text-xl font-semibold text-status-error">
              Accès non autorisé
            </h1>
            <p className="text-sm text-muted-foreground">
              Votre compte n&apos;est pas habilité à accéder à AI Bot Manager.
              Cette plateforme est réservée au personnel de l&apos;UN-CHK.
            </p>
            <p className="text-sm text-muted-foreground">
              Si vous pensez qu&apos;il s&apos;agit d&apos;une erreur,{" "}
              <a
                href="/help"
                className="text-primary underline hover:opacity-80"
              >
                contactez la DITSI
              </a>
              .
            </p>
          </div>

          <form action="/api/auth/rejection-logout" method="GET">
            <button
              type="submit"
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Retour à la page d&apos;accueil
            </button>
          </form>
        </div>
      </div>
      <Footer />
    </div>
  );
}
