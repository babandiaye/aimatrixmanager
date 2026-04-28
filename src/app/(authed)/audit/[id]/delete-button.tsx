"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { TrashIcon } from "@heroicons/react/24/outline";
import { deleteAuditLog } from "../actions";

export function DeleteAuditButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (
          !confirm("Supprimer cette entrée d'audit ? (irréversible)")
        )
          return;
        start(async () => {
          try {
            await deleteAuditLog(id);
          } catch (e) {
            alert(e instanceof Error ? e.message : "Erreur");
          }
        });
      }}
    >
      <TrashIcon className="size-4" />
      Supprimer
    </Button>
  );
}
