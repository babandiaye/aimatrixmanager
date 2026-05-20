import { signIn } from "@/auth";

/**
 * Route handler GET dédié à la redirection SSO Keycloak.
 *
 * Existe parce que `signIn()` côté serveur a besoin d'écrire des cookies
 * (CSRF, callback_url) — interdit dans un RSC mais autorisé dans un route
 * handler. `/login` redirige (307) ici en cas nominal pour éviter de rendre
 * une page HTML intermédiaire « Redirection vers Keycloak… ».
 *
 * Coté navigateur : 2 redirects en chaîne mais aucun rendu HTML —
 * l'utilisateur voit la page Keycloak directement.
 */
export async function GET() {
  await signIn("keycloak", { redirectTo: "/dashboard" });
}
