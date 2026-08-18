import type { UserRole } from "@prisma/client";

// Liste exhaustive des actions du système.
// Convention : les permissions sans suffixe = portée globale (ADMIN/MANAGER).
// Les permissions `.own` = portée propriétaire (ENSEIGNANT sur ses propres
// entités : agents qu'il a créés, cours où il enseigne sur Moodle).
export type Permission =
  // Plateforme / config système
  | "users.manage"
  | "settings.manage"
  // Plateformes Moodle (CRUD = ADMIN seul, view = MANAGER/AUDITOR/ENSEIGNANT)
  | "moodle.create"
  | "moodle.update"
  | "moodle.delete"
  | "moodle.view"
  // Rapatriement depuis Moodle (cours, activités Matrix). Séparé de
  // `moodle.update` : ça n'écrit rien côté Moodle et ne touche pas à la
  // config de la plateforme, ça ne fait que rafraîchir notre copie locale.
  // L'ENSEIGNANT en a besoin pour voir ses nouveaux cours sans dépendre
  // d'un admin.
  | "moodle.sync"
  // Diagnostic de connexion (« Tester »). Révèle le compte de service
  // Moodle et la version du site → outil d'exploitation, pas d'enseignant.
  | "moodle.test"
  // Agents IA — portée globale ou propriétaire (ENSEIGNANT)
  | "agents.create"
  | "agents.update"
  | "agents.update-own"
  | "agents.delete"
  | "agents.delete-own"
  | "agents.view"
  | "agents.view-own"
  // Affectations agent ↔ salon
  | "rooms.assign"
  | "rooms.assign-own"
  | "rooms.view"
  | "rooms.view-own"
  // Audit
  | "audit.view"
  | "audit.delete"
  // Configurations LLM.
  //   `.own`    : déclarer SA clé Anthropic/OpenAI. Ouvert à tous les rôles
  //               qui créent des agents — c'est leur clé, leur facture.
  //   `.shared` : gérer le catalogue commun (Ollama UN-CHK), donc le défaut
  //               d'usine servi à toute la plateforme. ADMIN seul.
  | "llm.manage-own"
  | "llm.manage-shared";

const MANAGER_PERMS: ReadonlySet<Permission> = new Set([
  "moodle.view", "moodle.sync", "moodle.test",
  "agents.create", "agents.update", "agents.delete", "agents.view",
  "rooms.assign", "rooms.view",
  "audit.view",
  "llm.manage-own",
]);

// ENSEIGNANT : peut créer ses propres agents et les affecter à ses cours.
// Voit les plateformes Moodle en lecture seule et peut lancer une sync
// (cours + activités Matrix) pour que ses nouveaux cours remontent sans
// intervention d'un admin. Ne peut ni créer, ni modifier, ni supprimer une
// plateforme — le wsToken reste hors de portée, /moodle/[id]/edit étant
// gardé par `moodle.update`.
const ENSEIGNANT_PERMS: ReadonlySet<Permission> = new Set([
  "moodle.view",
  "moodle.sync",
  "agents.create",
  "agents.update-own",
  "agents.delete-own",
  "agents.view-own",
  "rooms.assign-own",
  "rooms.view-own",
  "llm.manage-own",
]);

// AUDITOR : lecture seule stricte — pas de sync, qui écrit en base.
const AUDITOR_PERMS: ReadonlySet<Permission> = new Set([
  "moodle.view",
  "moodle.test",
  "agents.view",
  "rooms.view",
  "audit.view",
]);

export function can(role: UserRole, perm: Permission): boolean {
  if (role === "ADMIN") return true;
  if (role === "MANAGER") return MANAGER_PERMS.has(perm);
  if (role === "ENSEIGNANT") return ENSEIGNANT_PERMS.has(perm);
  if (role === "AUDITOR") return AUDITOR_PERMS.has(perm);
  return false;
}

// Helper "ou-bien" : retourne true si l'utilisateur a au moins une des
// permissions listées. Utile pour les vérifs "peut voir tout OU peut voir ses
// propres" sur un endpoint commun.
export function canAny(role: UserRole, ...perms: Permission[]): boolean {
  return perms.some((p) => can(role, p));
}

// Helper pour Server Components / API routes : jette si non autorisé
export function assertCan(role: UserRole, perm: Permission): void {
  if (!can(role, perm)) {
    throw new Error(`Forbidden: rôle ${role} n'a pas la permission ${perm}`);
  }
}

/**
 * Filtre Prisma à appliquer sur la table Room selon le rôle.
 * Note : pour ENSEIGNANT, le filtrage par "ses cours" se fait dans
 * teacher-scope.ts (il faut résoudre ses cours Moodle via WS d'abord).
 */
export function roomScopeFor(role: UserRole) {
  if (role === "ADMIN") return {};
  // MANAGER / AUDITOR : seulement les salons venant de Moodle (par défaut)
  // ENSEIGNANT : géré dans teacher-scope (filtre supplémentaire par courseId)
  return { source: "MOODLE" } as const;
}
