import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Keycloak from "next-auth/providers/keycloak";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isKeycloakActive, isKeycloakConfigured } from "@/lib/auth-config";
import type { UserRole } from "@prisma/client";

// Étend les types NextAuth pour exposer id et role dans la session
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
  }
  interface User {
    role?: UserRole;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const providers: NextAuthConfig["providers"] = [
  Credentials({
    name: "Email/Password",
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
];

// Keycloak n'est ajouté que si .env est configuré (kill switch).
// Le toggle DB est vérifié dans le callback signIn (sinon un POST direct
// /api/auth/signin/keycloak passerait outre le toggle).
if (isKeycloakConfigured()) {
  providers.push(
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
      issuer: process.env.KEYCLOAK_ISSUER!,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers,
  callbacks: {
    // Bloque le login Keycloak si désactivé en DB (même si l'env est set)
    async signIn({ account }) {
      if (account?.provider === "keycloak") {
        if (!(await isKeycloakActive())) return false;
      }
      return true;
    },
    // À chaque token (login + refresh), on recharge id/role/name depuis la DB
    async jwt({ token, user, trigger }) {
      const t = token as typeof token & { id?: string; role?: UserRole };
      if (user) {
        t.id = user.id;
        t.role = user.role;
        if (user.name) t.name = user.name;
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
      const t = token as typeof token & { id?: string; role?: UserRole };
      if (t.id) session.user.id = t.id;
      if (t.role) session.user.role = t.role;
      return session;
    },
  },
});
