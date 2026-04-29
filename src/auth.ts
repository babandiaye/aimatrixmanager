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

// Étend les types NextAuth pour exposer id, role, idToken (pour RP-initiated logout)
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
    idToken?: string;
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

// Keycloak — provider principal, présent dès que .env est configuré
if (isKeycloakConfigured()) {
  providers.push(
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
      issuer: process.env.KEYCLOAK_ISSUER!,
      // Keycloak vérifie déjà les emails côté UNCHK — on autorise le linking
      // automatique même si un compte local existait avec le même email
      // (utile pendant la migration).
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

// Credentials — désactivé par défaut. Sert d'escape hatch quand Keycloak est
// down ou cassé : on pose EMERGENCY_LOCAL_LOGIN=1 dans .env, redémarrage,
// connexion locale via /login?manual=1 avec un compte qui a un passwordHash
// en DB. Sans ce flag, Credentials n'est même pas chargé : zéro surface
// d'attaque par brute-force ou bypass via /api/auth/signin/credentials.
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

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers,
  callbacks: {
    // À chaque token (login + refresh), on recharge id/role/name depuis la DB
    // + on capture id_token et provider pour le RP-initiated logout Keycloak
    async jwt({ token, user, trigger, account }) {
      const t = token as typeof token & {
        id?: string;
        role?: UserRole;
        idToken?: string;
        provider?: string;
      };
      if (user) {
        t.id = user.id;
        t.role = user.role;
        if (user.name) t.name = user.name;
      }
      if (account) {
        // Capture l'id_token au moment du signin OIDC pour le logout futur
        if (account.id_token) t.idToken = account.id_token;
        if (account.provider) t.provider = account.provider;
      }
      // Lors d'un signIn (local ou OIDC), on synchronise depuis la DB —
      // garantit que le rôle/nom courants l'emportent sur les claims du token.
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
      }
      return t;
    },
    async session({ session, token }) {
      const t = token as typeof token & {
        id?: string;
        role?: UserRole;
        idToken?: string;
        provider?: string;
      };
      if (t.id) session.user.id = t.id;
      if (t.role) session.user.role = t.role;
      if (t.idToken) session.idToken = t.idToken;
      if (t.provider) session.provider = t.provider;
      return session;
    },
  },
  events: {
    // Bootstrap : le tout premier compte créé (User table vide jusque-là)
    // devient ADMIN. Évite l'aller-retour SQL manuel sur un fresh deploy.
    // updateMany + filtre `role: AUDITOR` : si une race fait que deux users
    // arrivent en même temps, on ne promeut que les comptes encore au défaut.
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
  },
});
