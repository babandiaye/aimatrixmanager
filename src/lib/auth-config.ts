/**
 * Keycloak est-il configuré dans .env ?
 * Si l'une des 3 vars manque, le provider n'est pas ajouté du tout — la page
 * de login bascule alors automatiquement sur le mode urgence.
 */
export function isKeycloakConfigured(): boolean {
  return Boolean(
    process.env.KEYCLOAK_CLIENT_ID &&
      process.env.KEYCLOAK_CLIENT_SECRET &&
      process.env.KEYCLOAK_ISSUER,
  );
}

/**
 * Mode urgence : Credentials provider activé. Désactivé par défaut.
 * À n'activer que si Keycloak est down ou cassé : `EMERGENCY_LOCAL_LOGIN=1`
 * dans .env puis redémarrage du service.
 */
export function isEmergencyLocalLogin(): boolean {
  return process.env.EMERGENCY_LOCAL_LOGIN === "1";
}
