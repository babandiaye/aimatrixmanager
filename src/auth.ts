import NextAuth, { type DefaultSession } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { cookies, headers } from "next/headers";
import authConfig from "./auth.config";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { UserRole } from "@prisma/client";

const log = logger.child({ mod: "auth" });

// Affiliations Keycloak autorisées à entrer sur aibotmanager. Les valeurs
// inconnues, null/undefined, "Etudiant" et "Tuteur" sont refusées avec
// renvoi vers /access-denied (cf. callback signIn). Liste blanche pour
// éviter qu'un nouveau type d'affiliation passe par défaut.
const ALLOWED_AFFILIATIONS = new Set<string>(["Personnel"]);

// Cookie qui transporte l'id_token Keycloak entre le rejet d'auth et la
// page /access-denied — permet à l'user de fermer proprement sa session
// SSO via le bouton « Retour ». Court (5 min), httpOnly, lax.
const REJECTION_COOKIE = "kc_rejected_id_token";
const REJECTION_COOKIE_TTL = 60 * 5;

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

// TTL en secondes — pour le rafraîchissement périodique du rôle dans le JWT.
// Compromis entre fraîcheur (un changement de rôle se propage en <60s) et
// charge (une requête DB toutes les 60s par session active).
const ROLE_REFRESH_TTL = 60;

// Décode le payload d'un JWT non-vérifié. On a déjà confiance dans
// l'id_token (il vient de Keycloak via le flow OIDC qu'Auth.js a vérifié) —
// ici on l'utilise uniquement pour extraire un claim custom qui ne fait
// pas partie de la réponse userinfo.
function decodeIdTokenClaim(
  idToken: string | null | undefined,
  claim: string,
): unknown {
  if (!idToken) return null;
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    return payload[claim] ?? null;
  } catch {
    return null;
  }
}

// Extrait l'IP cliente depuis les headers HTTP. nginx forwarde via
// X-Forwarded-For (chaîne d'IPs ; on prend la première = client réel).
// Fallback sur X-Real-IP si présent. Tronque pour éviter les headers
// abusivement longs.
async function getClientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]?.trim().slice(0, 64) ?? null;
    const real = h.get("x-real-ip");
    if (real) return real.slice(0, 64);
    return null;
  } catch {
    return null;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  callbacks: {
    // Gate d'entrée post-SSO. Keycloak a validé l'identité, mais on
    // restreint ici par `affiliation` (custom claim Keycloak) : seul
    // « Personnel » entre. Les autres valeurs (Etudiant, Tuteur, null,
    // affiliation inconnue) sont rejetées avec redirection vers
    // /access-denied. On capture l'id_token dans un cookie httpOnly
    // court (5min) pour permettre à /access-denied de proposer un
    // bouton « Retour » qui ferme la session Keycloak proprement.
    async signIn({ user, account, profile }) {
      // On ne filtre que les connexions OIDC Keycloak (pas les
      // adapters internes type credentials, qui n'existent plus mais
      // sait-on jamais).
      if (account?.provider !== "keycloak") return true;

      // Keycloak peut mettre certains claims dans l'id_token uniquement
      // (pas dans la réponse userinfo). Or Auth.js construit `profile`
      // depuis userinfo. On lit donc d'abord profile, et on fallback sur
      // le claim de l'id_token si absent — c'est exactement le même claim
      // (Keycloak les remplit depuis la même source).
      const affiliationFromProfile =
        typeof profile?.affiliation === "string"
          ? profile.affiliation
          : null;
      const affiliationFromIdToken = decodeIdTokenClaim(
        account.id_token,
        "affiliation",
      );
      const affiliation =
        affiliationFromProfile ??
        (typeof affiliationFromIdToken === "string"
          ? affiliationFromIdToken
          : null);
      const email = (user?.email ?? profile?.email ?? null) as
        | string
        | null;
      const ip = await getClientIp();

      if (!affiliation || !ALLOWED_AFFILIATIONS.has(affiliation)) {
        // Trace explicite — l'admin pourra retrouver les tentatives
        // dans la table AuthAuditLog.
        try {
          await prisma.authAuditLog.create({
            data: {
              type: "ACCESS_DENIED",
              email,
              provider: account.provider,
              ipAddress: ip,
              reason: `affiliation=${affiliation ?? "null"}`,
            },
          });
        } catch (e) {
          log.warn({ err: e }, "AuthAuditLog ACCESS_DENIED insert failed");
        }

        // Dépose l'id_token dans un cookie httpOnly pour permettre à
        // /access-denied de fermer la session SSO Keycloak.
        if (account.id_token) {
          try {
            const c = await cookies();
            c.set(REJECTION_COOKIE, account.id_token, {
              httpOnly: true,
              secure: true,
              sameSite: "lax",
              path: "/",
              maxAge: REJECTION_COOKIE_TTL,
            });
          } catch (e) {
            log.warn({ err: e }, "REJECTION_COOKIE set failed");
          }
        }

        log.info(
          { email, ip, affiliation },
          "Sign-in refusé : affiliation non autorisée",
        );

        // Return d'URL string → Auth.js redirige vers cette page au lieu
        // de créer la session. Le query ?reason=... est purement
        // cosmétique (déjà loggé en DB).
        return "/access-denied?reason=affiliation";
      }

      return true;
    },
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
    // On n'écrase pas un role déjà ADMIN/MANAGER (paranoïa : seed ou patch
    // manuel pré-existant), mais on accepte AUDITOR et ENSEIGNANT comme
    // candidats à la promotion (les deux rôles possibles selon le défaut
    // Prisma au moment de la création).
    async createUser({ user }) {
      const total = await prisma.user.count();
      if (total === 1 && user.id) {
        await prisma.user.updateMany({
          where: { id: user.id, role: { in: ["AUDITOR", "ENSEIGNANT"] } },
          data: { role: "ADMIN" },
        });
        log.info(
          { userId: user.id, email: user.email },
          "Premier utilisateur promu ADMIN (bootstrap)",
        );
      }
    },
    // Audit : trace chaque connexion réussie + met à jour User.lastLoginAt
    // et User.lastLoginIp. Fail-safe : si l'insert échoue (DB momentanément
    // down), on log mais on ne bloque pas le signin.
    async signIn({ user, account }) {
      const ip = await getClientIp();
      try {
        await prisma.authAuditLog.create({
          data: {
            type: "SIGN_IN",
            userId: user.id ?? null,
            email: user.email ?? null,
            provider: account?.provider ?? null,
            ipAddress: ip,
          },
        });
      } catch (e) {
        log.warn({ err: e }, "AuthAuditLog SIGN_IN insert failed");
      }
      if (user.id) {
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date(), lastLoginIp: ip },
          });
        } catch (e) {
          log.warn({ err: e }, "User lastLogin* update failed");
        }
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
