import type { UserRole } from "@prisma/client";

// Liste exhaustive des actions du système. Étendre ici quand on ajoute une feature.
export type Permission =
  // Plateforme / config système
  | "users.manage"
  | "settings.manage"
  // Plateformes Moodle (CRUD = ADMIN seul, view = tous)
  | "moodle.create"
  | "moodle.update"
  | "moodle.delete"
  | "moodle.view"
  // Agents IA
  | "agents.create"
  | "agents.update"
  | "agents.delete"
  | "agents.view"
  // Affectations agent ↔ salon
  | "rooms.assign"
  | "rooms.view"
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
  if (role === "AUDITOR") return AUDITOR_PERMS.has(perm);
  return false;
}

// Helper pour Server Components / API routes : jette si non autorisé
export function assertCan(role: UserRole, perm: Permission): void {
  if (!can(role, perm)) {
    throw new Error(`Forbidden: rôle ${role} n'a pas la permission ${perm}`);
  }
}
