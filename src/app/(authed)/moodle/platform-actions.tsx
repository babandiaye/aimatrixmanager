"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  ArrowPathIcon,
  PencilSquareIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import {
  deletePlatform,
  syncCoursesForPlatform,
  togglePlatformEnabled,
} from "./actions";

export function PlatformActions({
  id,
  enabled,
  canUpdate,
  canDelete,
}: {
  id: string;
  enabled: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center justify-end gap-2">
      {canUpdate && (
        <>
          <Switch
            checked={enabled}
            disabled={pending}
            title={enabled ? "Désactiver" : "Activer"}
            onCheckedChange={(next) => {
              start(async () => {
                try {
                  await togglePlatformEnabled(id, next);
                } catch (e) {
                  alert(e instanceof Error ? e.message : "Erreur");
                }
              });
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={pending || !enabled}
            title="Synchroniser les cours"
            onClick={() => {
              start(async () => {
                try {
                  const r = await syncCoursesForPlatform(id);
                  alert(
                    `Sync OK : ${r.total} cours (${r.inserted} créés, ${r.updated} mis à jour)`,
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
          </Button>
          <Link
            href={`/moodle/${id}/edit`}
            className={buttonVariants({ variant: "outline", size: "icon-sm" })}
            title="Modifier"
          >
            <PencilSquareIcon className="size-4" />
          </Link>
        </>
      )}
      {canDelete && (
        <Button
          type="button"
          variant="destructive"
          size="icon-sm"
          disabled={pending}
          title="Supprimer"
          onClick={() => {
            if (
              !confirm(
                "Supprimer cette plateforme ? Les cours liés seront aussi supprimés.",
              )
            )
              return;
            start(async () => {
              try {
                await deletePlatform(id);
              } catch (e) {
                alert(e instanceof Error ? e.message : "Erreur");
              }
            });
          }}
        >
          <TrashIcon className="size-4" />
        </Button>
      )}
    </div>
  );
}
