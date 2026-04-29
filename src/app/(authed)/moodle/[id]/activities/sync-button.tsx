"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { syncMatrixActivitiesForPlatform } from "../../actions";

export function SyncActivitiesButton({ platformId }: { platformId: string }) {
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      disabled={pending}
      onClick={() => {
        start(async () => {
          try {
            const r = await syncMatrixActivitiesForPlatform(platformId);
            alert(
              `Sync OK : ${r.total} activité(s) — ${r.inserted} créée(s), ${r.updated} mise(s) à jour, ${r.removed} supprimée(s).\n` +
                `Salons marqués Moodle : ${r.linkedRooms} (lien direct) + ${r.linkedByName} (par nom).`,
            );
          } catch (e) {
            alert(e instanceof Error ? e.message : "Erreur");
          }
        });
      }}
    >
      <ArrowPathIcon
        className={`size-4 ${pending ? "animate-spin" : ""}`}
      />
      Synchroniser
    </Button>
  );
}
