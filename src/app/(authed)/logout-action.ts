"use server";

import { signOut } from "@/auth";

/**
 * Déconnexion silencieuse.
 *
 * Le travail de fond (tuer la session SSO côté Keycloak) est fait par
 * `events.signOut` dans auth.ts via un fetch backchannel — l'utilisateur
 * ne voit donc jamais la page « Confirmation de déconnexion » de Keycloak.
 *
 * Ici on se contente de détruire le cookie NextAuth et de rediriger vers
 * la landing publique `/`.
 */
export async function logoutCompletely() {
  await signOut({ redirectTo: "/" });
}
