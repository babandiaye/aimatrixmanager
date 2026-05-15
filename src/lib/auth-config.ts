/**
 * Keycloak est la seule source d'auth supportée. Cette fonction reste pour
 * vérifier au démarrage (ou dans le UI settings) que la config est bien là.
 */
export function isKeycloakConfigured(): boolean {
  return Boolean(
    process.env.KEYCLOAK_CLIENT_ID &&
      process.env.KEYCLOAK_CLIENT_SECRET &&
      process.env.KEYCLOAK_ISSUER,
  );
}
