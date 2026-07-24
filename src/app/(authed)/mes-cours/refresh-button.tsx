"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { refreshMyCoursesFromMoodle } from "./actions";

export function RefreshMyCoursesButton() {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        start(async () => {
          try {
            const r = await refreshMyCoursesFromMoodle();
            const parts = [
              `${r.platformsSynced} plateforme(s) synchronisée(s)`,
              `${r.activitiesFound} activité(s) Matrix détectée(s)`,
              `${r.roomsImported} nouveau(x) salon(s) importé(s) depuis Synapse`,
              `${r.roomsLinked} salon(s) lié(s) à un cours Moodle`,
            ];
            if (r.errors.length > 0) {
              parts.push(`Erreurs :\n- ${r.errors.join("\n- ")}`);
            }
            alert(`Rafraîchissement OK :\n${parts.join("\n")}`);
            router.refresh();
          } catch (e) {
            alert(e instanceof Error ? e.message : "Erreur");
          }
        });
      }}
      title="Force la re-résolution de tes cours et des activités mod_matrix depuis Moodle."
    >
      <ArrowPathIcon
        className={`size-4 ${pending ? "animate-spin" : ""}`}
      />
      {pending ? "Rafraîchissement…" : "Rafraîchir depuis Moodle"}
    </Button>
  );
}
