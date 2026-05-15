import NextAuth, { type DefaultSession } from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { UserRole } from "@prisma/client";

const log = logger.child({ mod: "auth" });

// Étend les types NextAuth pour exposer id, role et l'id_token Keycloak.
// L'id_token (~1.2 KB) est stocké dans le JWT pour pouvoir faire un logout
// backchannel propre via `events.signOut` (cf. livestream pattern).
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
    provider?: string;
  }
  interface User {
    role?: UserRole;
  }
}

// Auth Keycloak uniquement. Voir README → section Authentification.
const providers = [
  Keycloak({
    clientId: process.env.KEYCLOAK_CLIENT_ID!,
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
    issuer: process.env.KEYCLOAK_ISSUER!,
    allowDangerousEmailAccountLinking: true,
  }),
];

// TTL en secondes — pour le rafraîchissement périodique du rôle dans le JWT.
// Compromis entre fraîcheur (un changement de rôle se propage en <60s) et
// charge (une requête DB toutes les 60s par session active).
const ROLE_REFRESH_TTL = 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
    // 8h pour une plateforme d'admin (vs 30j par défaut). Réduit la fenêtre
    // d'exploitation d'un cookie compromis.
    maxAge: 8 * 60 * 60,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers,
  callbacks: {
    async jwt({ token, user, trigger, account }) {
      const t = token as typeof token & {
        id?: string;
        role?: UserRole;
        provider?: string;
        id_token?: string;
        roleRefreshedAt?: number;
      };
      const now = Math.floor(Date.now() / 1000);

      // Sign-in initial : on capture id, role, provider depuis le user qui
      // vient du provider OIDC (adapter upsert).
      if (user) {
        t.id = user.id;
        t.role = user.role;
        if (user.name) t.name = user.name;
      }
      if (account?.provider) {
        t.provider = account.provider;
      }
      // On garde l'id_token dans le JWT pour le logout backchannel — sans ça,
      // Keycloak affiche sa page « Confirmation de déconnexion » à la place.
      if (account?.id_token) {
        t.id_token = account.id_token;
      }

      // Sync DB au signin (peu importe le provider) — le rôle DB l'emporte
      // toujours sur les claims OIDC qui pourraient être stale.
      if (trigger === "signIn" && t.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: t.email },
          select: { id: true, role: true, name: true },
        });
        if (dbUser) {
          t.id = dbUser.id;
          t.role = dbUser.role;
          if (dbUser.name) t.name = dbUser.name;
        }
        t.roleRefreshedAt = now;
        return t;
      }

      // Refresh périodique : si > 60s depuis le dernier check, on relit le
      // rôle depuis la DB. Garantit qu'un changement de rôle (rétrogradation,
      // suppression de compte) se propage rapidement sans attendre la
      // déconnexion. On garde le user.id stable ; seul role/name peut bouger.
      if (
        t.id &&
        (!t.roleRefreshedAt || now - t.roleRefreshedAt > ROLE_REFRESH_TTL)
      ) {
        const fresh = await prisma.user.findUnique({
          where: { id: t.id },
          select: { role: true, name: true },
        });
        if (!fresh) {
          // User supprimé en DB → invalide le token (le nouveau token n'aura
          // ni id ni role, le proxy redirigera vers /login).
          delete t.id;
          delete t.role;
          return t;
        }
        t.role = fresh.role;
        if (fresh.name) t.name = fresh.name;
        t.roleRefreshedAt = now;
      }

      return t;
    },
    async session({ session, token }) {
      const t = token as typeof token & {
        id?: string;
        role?: UserRole;
        provider?: string;
      };
      if (t.id) session.user.id = t.id;
      if (t.role) session.user.role = t.role;
      if (t.provider) session.provider = t.provider;
      return session;
    },
  },
  events: {
    // Bootstrap : le tout premier compte créé devient ADMIN (cf README).
    async createUser({ user }) {
      const total = await prisma.user.count();
      if (total === 1 && user.id) {
        await prisma.user.updateMany({
          where: { id: user.id, role: "AUDITOR" },
          data: { role: "ADMIN" },
        });
        log.info(
          { userId: user.id, email: user.email },
          "Premier utilisateur promu ADMIN (bootstrap)",
        );
      }
    },
    // Audit : trace chaque connexion réussie. Fail-safe : si l'insert
    // échoue (DB momentanément down), on log mais on ne bloque pas le signin.
    async signIn({ user, account }) {
      try {
        await prisma.authAuditLog.create({
          data: {
            type: "SIGN_IN",
            userId: user.id ?? null,
            email: user.email ?? null,
            provider: account?.provider ?? null,
          },
        });
      } catch (e) {
        log.warn({ err: e }, "AuthAuditLog SIGN_IN insert failed");
      }
    },
    async signOut(message) {
      const t =
        "token" in message
          ? (message.token as {
              id?: string;
              email?: string | null;
              provider?: string;
              id_token?: string;
            } | null)
          : null;

      // 1) Audit log (best-effort, ne bloque pas le logout)
      try {
        await prisma.authAuditLog.create({
          data: {
            type: "SIGN_OUT",
            userId: t?.id ?? null,
            email: t?.email ?? null,
            provider: t?.provider ?? null,
          },
        });
      } catch (e) {
        log.warn({ err: e }, "AuthAuditLog SIGN_OUT insert failed");
      }

      // 2) Backchannel logout Keycloak : fetch serveur → Keycloak qui
      // invalide la session SSO sans que le navigateur ne voie la page
      // « Confirmation de déconnexion ». Avec id_token_hint valide,
      // Keycloak ne demande pas confirmation. On ne suit pas la redirection
      // de réponse — NextAuth gère le redirect côté navigateur via signOut.
      if (t?.id_token && process.env.KEYCLOAK_ISSUER) {
        try {
          const url = new URL(
            `${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/logout`,
          );
          url.searchParams.set("id_token_hint", t.id_token);
          if (process.env.KEYCLOAK_CLIENT_ID) {
            url.searchParams.set("client_id", process.env.KEYCLOAK_CLIENT_ID);
          }
          const r = await fetch(url.toString(), {
            method: "GET",
            redirect: "manual",
          });
          log.info(
            { status: r.status, userId: t.id },
            "Keycloak backchannel logout",
          );
        } catch (e) {
          log.warn({ err: e }, "Keycloak backchannel logout failed");
        }
      }
    },
  },
});
