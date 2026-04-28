"use client";

import { useTransition, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { syncRoomsFromSynapse } from "./actions";

export function SyncRoomsButton() {
  const [pending, start] = useTransition();
  const [info, setInfo] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      {info && <span className="text-sm text-muted-foreground">{info}</span>}
      <Button
        type="button"
        size="lg"
        disabled={pending}
        onClick={() => {
          setInfo(null);
          start(async () => {
            try {
              const r = await syncRoomsFromSynapse();
              setInfo(
                `${r.total} salon(s) — ${r.inserted} créés, ${r.updated} mis à jour`,
              );
            } catch (e) {
              setInfo(
                `Erreur : ${e instanceof Error ? e.message : "inconnue"}`,
              );
            }
          });
        }}
      >
        <ArrowPathIcon className={`size-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Synchronisation..." : "Synchroniser depuis Synapse"}
      </Button>
    </div>
  );
}
