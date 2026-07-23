import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "auth.rejection-logout" });

const REJECTION_COOKIE = "kc_rejected_id_token";

/**
 * Logout silencieux de la session Keycloak après un rejet d'accès
 * (affiliation insuffisante). Pas de session NextAuth à détruire (le rejet
 * a court-circuité sa création) mais Keycloak garde une session SSO côté
 * navigateur — si on ne la ferme pas, l'user retombera direct sur Keycloak
 * au prochain /login et la boucle access-denied recommencera.
 *
 * Stratégie :
 *  1. Lit l'id_token déposé par le callback signIn (cookie httpOnly 5min)
 *  2. Appelle l'endpoint Keycloak /protocol/openid-connect/logout avec
 *     id_token_hint → invalidation backchannel sans page de confirmation
 *  3. Supprime le cookie temp
 *  4. Redirige vers la page d'accueil (`/`)
 *
 * Best-effort : si Keycloak n'est pas joignable ou si le cookie a expiré,
 * on log mais on redirige quand même (sinon l'user reste coincé).
 */
export async function GET() {
  const c = await cookies();
  const idToken = c.get(REJECTION_COOKIE)?.value;

  if (idToken && process.env.KEYCLOAK_ISSUER) {
    try {
      const url = new URL(
        `${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/logout`,
      );
      url.searchParams.set("id_token_hint", idToken);
      if (process.env.KEYCLOAK_CLIENT_ID) {
        url.searchParams.set("client_id", process.env.KEYCLOAK_CLIENT_ID);
      }
      const r = await fetch(url.toString(), {
        method: "GET",
        redirect: "manual",
      });
      log.info(
        { status: r.status },
        "Keycloak rejection backchannel logout",
      );
    } catch (e) {
      log.warn({ err: e }, "Keycloak rejection backchannel logout failed");
    }
  }

  // Quoi qu'il arrive (cookie expiré, Keycloak down, etc.), on retire
  // le cookie et on renvoie l'user à l'accueil.
  try {
    c.delete(REJECTION_COOKIE);
  } catch {
    /* noop */
  }

  redirect("/");
}
