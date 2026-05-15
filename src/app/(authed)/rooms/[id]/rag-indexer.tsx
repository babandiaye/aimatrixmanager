"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import {
  fullReindexCourse,
  toggleCourseReindex,
} from "@/app/(authed)/moodle/actions";

export function RagIndexer({
  courseDbId,
  reindexEnabled,
  totalChunks,
  embeddedChunks,
  lastIndexedAt,
  canIndex,
}: {
  courseDbId: string;
  reindexEnabled: boolean;
  totalChunks: number;
  embeddedChunks: number;
  lastIndexedAt: Date | null;
  canIndex: boolean;
}) {
  const [pending, start] = useTransition();
  const fullyIndexed = totalChunks > 0 && embeddedChunks === totalChunks;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="Chunks générés" value={String(totalChunks)} />
        <Stat
          label="Embeddings calculés"
          value={`${embeddedChunks} / ${totalChunks}`}
          tone={
            totalChunks === 0
              ? "muted"
              : fullyIndexed
                ? "success"
                : "warning"
          }
        />
        <Stat
          label="Dernière indexation"
          value={
            lastIndexedAt
              ? new Date(lastIndexedAt).toLocaleString("fr-FR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })
              : "—"
          }
        />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
        <div className="space-y-0.5">
          <div className="text-sm font-medium">RAG actif sur ce cours</div>
          <div className="text-xs text-muted-foreground">
            Si désactivé, les agents répondent sans contexte du cours (pas de
            recherche dans les supports).
          </div>
        </div>
        <Switch
          checked={reindexEnabled}
          disabled={!canIndex || pending}
          onCheckedChange={(next) => {
            start(async () => {
              try {
                await toggleCourseReindex(courseDbId, next);
              } catch (e) {
                alert(e instanceof Error ? e.message : "Erreur");
              }
            });
          }}
        />
      </div>

      {canIndex && (
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            if (
              !confirm(
                "Lancer une réindexation complète ? Cela peut prendre plusieurs minutes selon la taille du cours.",
              )
            )
              return;
            start(async () => {
              try {
                const r = await fullReindexCourse(courseDbId);
                alert(
                  `Indexation OK :\n` +
                    `• ${r.sync.sections} section(s), ${r.sync.resources} resource(s) syncées\n` +
                    `• ${r.extract.resources.processed} extraction(s) (${r.extract.resources.skipped} skip, ${r.extract.resources.failed} fail)\n` +
                    `• ${r.embed.embedded} embedding(s) calculés (${r.embed.alreadyEmbedded} déjà présents)`,
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
          {pending ? "Indexation en cours…" : "Réindexer le cours"}
        </Button>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted" | "success" | "warning";
}) {
  const valueClass =
    tone === "success"
      ? "text-status-published"
      : tone === "warning"
        ? "text-status-unpublished"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}
