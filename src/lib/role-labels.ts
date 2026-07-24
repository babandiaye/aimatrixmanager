import type { UserRole } from "@prisma/client";

/**
 * Libellé français des rôles pour l'affichage UI (badges, TopBar, tableaux).
 * Les valeurs Prisma restent en anglais (ADMIN/MANAGER/…) pour l'API, la
 * DB, et le code — cette map traduit uniquement au moment du rendu.
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrateur",
  MANAGER: "Gestionnaire",
  ENSEIGNANT: "Enseignant",
  AUDITOR: "Auditeur",
};

export function roleLabel(role: UserRole | string): string {
  return ROLE_LABELS[role as UserRole] ?? role;
}
