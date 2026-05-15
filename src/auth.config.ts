import type { NextAuthConfig } from "next-auth";
import Keycloak from "next-auth/providers/keycloak";

/**
 * Config edge-safe pour le middleware NextAuth.
 *
 * Ne PAS importer Prisma ici — le middleware tourne en Edge runtime par défaut
 * et n'a pas accès aux modules Node natifs (pg, crypto, etc.). Les callbacks
 * qui touchent la DB (jwt refresh, events.signIn, signOut) restent dans
 * `auth.ts`.
 */
export default {
  providers: [
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
      issuer: process.env.KEYCLOAK_ISSUER!,
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },
} satisfies NextAuthConfig;
