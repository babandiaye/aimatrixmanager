"use server";

import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

/**
 * Déconnexion complète : détruit la session locale (NextAuth) ET la session
 * SSO Keycloak via RP-initiated logout (OIDC). L'utilisateur ne voit pas le
 * détour Keycloak — `post_logout_redirect_uri` ramène immédiatement sur la
 * home.
 *
 * L'id_token n'est pas embarqué dans le JWT (~1-2 KB de surcharge à chaque
 * requête) — il est lu à la volée depuis la table `Account` que le
 * PrismaAdapter alimente au signin OIDC.
 */
export async function logoutCompletely() {
  const session = await auth();
  const userId = session?.user?.id;
  const provider = session?.provider;

  let idToken: string | null = null;
  if (provider === "keycloak" && userId) {
    const account = await prisma.account.findFirst({
      where: { userId, provider: "keycloak" },
      select: { id_token: true },
      orderBy: { id: "desc" }, // au cas où plusieurs (peu probable)
    });
    idToken = account?.id_token ?? null;
  }

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
