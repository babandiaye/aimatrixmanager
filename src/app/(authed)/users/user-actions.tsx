"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TrashIcon } from "@heroicons/react/24/outline";
import type { UserRole } from "@prisma/client";
import { deleteUser, updateUserRole } from "./actions";
import { PasswordResetDialog } from "./password-reset-dialog";

export function UserActions({
  userId,
  currentRole,
  isSelf,
  isLastAdmin,
  isLocal,
  email,
  name,
}: {
  userId: string;
  currentRole: UserRole;
  isSelf: boolean;
  isLastAdmin: boolean;
  isLocal: boolean;
  email: string;
  name: string | null;
}) {
  const [pending, start] = useTransition();

  // Self → on bloque le changement de rôle (anti lock-out)
  // Last admin → on bloque la rétrogradation et la suppression
  const roleLocked = isSelf;
  const deleteLocked = isSelf || isLastAdmin;

  return (
    <div className="flex items-center justify-end gap-2">
      <Select
        value={currentRole}
        disabled={roleLocked || pending}
        onValueChange={(next) => {
          if (!next || next === currentRole) return;
          start(async () => {
            try {
              await updateUserRole(userId, next);
            } catch (e) {
              alert(e instanceof Error ? e.message : "Erreur");
            }
          });
        }}
      >
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ADMIN">ADMIN</SelectItem>
          <SelectItem value="MANAGER">MANAGER</SelectItem>
          <SelectItem value="AUDITOR">AUDITOR</SelectItem>
        </SelectContent>
      </Select>

      {isLocal && (
        <PasswordResetDialog userId={userId} email={email} name={name} />
      )}

      <Button
        type="button"
        variant="destructive"
        size="icon-sm"
        disabled={deleteLocked || pending}
        title={
          isSelf
            ? "Tu ne peux pas te supprimer toi-même"
            : isLastAdmin
              ? "Dernier administrateur — interdit"
              : "Supprimer"
        }
        onClick={() => {
          if (
            !confirm("Supprimer définitivement ce compte ? (irréversible)")
          )
            return;
          start(async () => {
            try {
              await deleteUser(userId);
            } catch (e) {
              alert(e instanceof Error ? e.message : "Erreur");
            }
          });
        }}
      >
        <TrashIcon className="size-4" />
      </Button>
    </div>
  );
}
