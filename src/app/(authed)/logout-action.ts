"use server";

import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";

/**
 * Déconnexion complète : détruit la session locale (NextAuth) ET la session SSO
 * Keycloak via RP-initiated logout (OIDC). L'utilisateur ne voit pas le détour
 * Keycloak — `post_logout_redirect_uri` ramène immédiatement sur la home.
 */
export async function logoutCompletely() {
  const session = await auth();
  const idToken = session?.idToken;
  const provider = session?.provider;

  await signOut({ redirect: false });

  if (provider === "keycloak" && idToken && process.env.KEYCLOAK_ISSUER) {
    const baseUrl =
      process.env.AUTH_URL ??
      process.env.NEXTAUTH_URL ??
      "http://localhost:3000";
    const params = new URLSearchParams({
      id_token_hint: idToken,
      post_logout_redirect_uri: `${baseUrl}/`,
    });
    redirect(
      `${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/logout?${params}`,
    );
  }

  redirect("/login");
}
