import { prisma } from "@/lib/prisma";

export const SETTINGS_ID = "global";

/**
 * Keycloak est-il configuré dans .env (kill switch) ?
 * Si l'une des 3 vars est manquante, Keycloak est invisible partout.
 */
export function isKeycloakConfigured(): boolean {
  return Boolean(
    process.env.KEYCLOAK_CLIENT_ID &&
      process.env.KEYCLOAK_CLIENT_SECRET &&
      process.env.KEYCLOAK_ISSUER,
  );
}

/**
 * Keycloak est-il actif (env + setting DB) ?
 * - env vide → false (kill switch)
 * - env set + setting DB true → true
 * - env set + setting DB false → false
 */
export async function isKeycloakActive(): Promise<boolean> {
  if (!isKeycloakConfigured()) return false;
  const settings = await prisma.systemSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID, keycloakEnabled: true },
    select: { keycloakEnabled: true },
  });
  return settings.keycloakEnabled;
}
