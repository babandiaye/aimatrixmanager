"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import {
  fullReindexCourse,
  getRagJobStatus,
  toggleCourseReindex,
} from "@/app/(authed)/moodle/actions";

type JobStatus = Awaited<ReturnType<typeof getRagJobStatus>>;

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
  const [job, setJob] = useState<JobStatus | null>(null);
  const fullyIndexed = totalChunks > 0 && embeddedChunks === totalChunks;
  const isJobRunning =
    job?.state === "active" ||
    job?.state === "waiting" ||
    job?.state === "delayed";

  // Polling : tant qu'un job est en cours, on rafraîchit toutes les 2s.
  // Au reload, on ne fait PAS de window.reload() automatique si le job est
  // déjà completed — sinon boucle infinie (BullMQ garde l'état "completed"
  // 24h, donc à chaque mount on voyait "completed" et on reloadait).
  // On ne déclenche le reload que si on a observé la transition
  // active/waiting → completed au sein de la session courante.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasRunning = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        const s = await getRagJobStatus(courseDbId);
        if (cancelled) return;
        setJob(s);
        const stillRunning =
          s.state === "active" ||
          s.state === "waiting" ||
          s.state === "delayed";
        if (stillRunning) {
          wasRunning = true;
          timer = setTimeout(tick, 2000);
        } else if (s.state === "completed" && wasRunning) {
          // On a observé la transition → reload une seule fois
          wasRunning = false;
          window.location.reload();
        }
        // Si completed mais !wasRunning : on est juste arrivé sur la page,
        // pas de reload, on affiche les stats actuelles tel quel.
      } catch {
        timer = setTimeout(tick, 5000);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [courseDbId]);

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

      {isJobRunning && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-blue-50 p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-primary">
              {job?.state === "waiting" || job?.state === "delayed"
                ? "Indexation en file d'attente…"
                : "Indexation en cours…"}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {Math.round(job?.progress ?? 0)}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-card">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${job?.progress ?? 0}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Le worker tourne en arrière-plan — tu peux quitter cette page,
            l&apos;indexation continuera. Au retour, la barre se remettra à
            jour automatiquement.
          </div>
        </div>
      )}

      {job?.state === "failed" && (
        <div className="rounded-lg border border-status-error/30 bg-status-error/5 p-4 text-sm">
          <div className="font-medium text-status-error">
            Échec d&apos;indexation
          </div>
          {job.error && (
            <div className="mt-1 font-mono text-xs text-muted-foreground">
              {job.error}
            </div>
          )}
          <div className="mt-2 text-xs text-muted-foreground">
            Tu peux relancer ; le worker reprendra où il en était (chunks déjà
            embeddés sont préservés).
          </div>
        </div>
      )}

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
          disabled={pending || isJobRunning}
          onClick={() => {
            if (
              !confirm(
                "Lancer une réindexation complète ? Le job tourne en arrière-plan, tu peux quitter la page.",
              )
            )
              return;
            start(async () => {
              try {
                const r = await fullReindexCourse(courseDbId);
                if (r.alreadyQueued) {
                  alert("Un job est déjà en cours pour ce cours.");
                }
                // Force un poll immédiat pour afficher la barre
                const s = await getRagJobStatus(courseDbId);
                setJob(s);
              } catch (e) {
                alert(e instanceof Error ? e.message : "Erreur");
              }
            });
          }}
        >
          <ArrowPathIcon
            className={`size-4 ${pending || isJobRunning ? "animate-spin" : ""}`}
          />
          {isJobRunning
            ? "Indexation en cours…"
            : pending
              ? "Démarrage…"
              : "Réindexer le cours"}
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
