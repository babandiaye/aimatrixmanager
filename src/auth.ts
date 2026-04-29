import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Keycloak from "next-auth/providers/keycloak";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isEmergencyLocalLogin, isKeycloakConfigured } from "@/lib/auth-config";
import { logger } from "@/lib/logger";
import type { UserRole } from "@prisma/client";

const log = logger.child({ mod: "auth" });

// Étend les types NextAuth pour exposer id, role.
//
// ⚠️ Volontairement, on ne stocke PAS `idToken` dans la session JWT — il fait
// 1-2 KB et embarque chaque requête. Le `id_token` Keycloak est déjà persisté
// dans la table `Account` par le PrismaAdapter ; on le ré-extrait au moment
// du logout via `Account.findFirst({ provider: "keycloak", userId })`.
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

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const providers: NextAuthConfig["providers"] = [];

if (isKeycloakConfigured()) {
  providers.push(
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
      issuer: process.env.KEYCLOAK_ISSUER!,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

if (isEmergencyLocalLogin()) {
  log.warn("EMERGENCY_LOCAL_LOGIN actif — Credentials provider chargé");
  providers.push(
    Credentials({
      name: "Email/Password (urgence)",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (!user || !user.passwordHash) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
    }),
  );
}

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
        roleRefreshedAt?: number;
      };
      const now = Math.floor(Date.now() / 1000);

      // Sign-in initial : on capture id, role, provider depuis le user qui
      // vient du provider (Credentials → DB direct ; OIDC → adapter upsert).
      if (user) {
        t.id = user.id;
        t.role = user.role;
        if (user.name) t.name = user.name;
      }
      if (account?.provider) {
        t.provider = account.provider;
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
      try {
        // signOut event reçoit { session } (DB strategy) ou { token } (JWT)
        const t =
          "token" in message
            ? (message.token as {
                id?: string;
                email?: string | null;
                provider?: string;
              } | null)
            : null;
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
    },
  },
});
