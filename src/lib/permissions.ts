import type { UserRole } from "@prisma/client";

// Liste exhaustive des actions du système.
// Convention : les permissions sans suffixe = portée globale (ADMIN/MANAGER).
// Les permissions `.own` = portée propriétaire (ENSEIGNANT sur ses propres
// entités : agents qu'il a créés, cours où il enseigne sur Moodle).
export type Permission =
  // Plateforme / config système
  | "users.manage"
  | "settings.manage"
  // Plateformes Moodle (CRUD = ADMIN seul, view = MANAGER/AUDITOR)
  | "moodle.create"
  | "moodle.update"
  | "moodle.delete"
  | "moodle.view"
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
  // Knowledge base RAG
  | "kb.write"
  | "kb.view"
  // Audit
  | "audit.view"
  | "audit.delete";

const MANAGER_PERMS: ReadonlySet<Permission> = new Set([
  "moodle.view",
  "agents.create", "agents.update", "agents.delete", "agents.view",
  "rooms.assign", "rooms.view",
  "kb.write", "kb.view",
  "audit.view",
]);

// ENSEIGNANT : peut créer ses propres agents et les affecter à ses cours.
// Pas d'accès aux plateformes Moodle (config admin), pas aux autres users.
const ENSEIGNANT_PERMS: ReadonlySet<Permission> = new Set([
  "agents.create",
  "agents.update-own",
  "agents.delete-own",
  "agents.view-own",
  "rooms.assign-own",
  "rooms.view-own",
  "kb.view",
]);

const AUDITOR_PERMS: ReadonlySet<Permission> = new Set([
  "moodle.view",
  "agents.view",
  "rooms.view",
  "kb.view",
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
