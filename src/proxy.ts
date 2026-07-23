import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "./auth.config";

// Edge-safe auth (sans adapter Prisma). Le refresh de rôle + audit logs
// restent dans `@/auth` qui tourne au niveau page (Node runtime).
const { auth } = NextAuth(authConfig);

const PUBLIC_PREFIXES = ["/login", "/api/auth"];
// /access-denied : pas de session NextAuth (l'auth a été rejetée), donc
// public — sinon boucle de redirect vers /login.
// /help : accessible aux users rejetés pour qu'ils trouvent les coordonnées
// DITSI et la FAQ d'accès.
const PUBLIC_EXACT = ["/", "/access-denied", "/help"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (isPublic) return NextResponse.next();

  if (!req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

// Exclut les fichiers statiques de Next et l'image optimizer
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
