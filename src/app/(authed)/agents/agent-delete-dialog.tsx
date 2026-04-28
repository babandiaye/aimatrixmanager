"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ExclamationTriangleIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { deleteAgent } from "./actions";

export function AgentDeleteDialog({
  agentId,
  slug,
  name,
}: {
  agentId: string;
  slug: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmText("");
      setError(null);
    }
  }, [open]);

  const valid = confirmText.trim() === slug;

  const submit = () => {
    if (!valid) return;
    setError(null);
    start(async () => {
      try {
        await deleteAgent(agentId);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur");
      }
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="icon-sm"
        title="Supprimer l'agent"
        onClick={() => setOpen(true)}
      >
        <TrashIcon className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-status-error/10 p-2">
                <ExclamationTriangleIcon className="size-6 text-status-error" />
              </div>
              <div>
                <DialogTitle>Supprimer l&apos;agent ?</DialogTitle>
                <DialogDescription>Action irréversible</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-status-error/30 bg-status-error/5 p-3 text-sm space-y-2">
              <p className="font-medium text-foreground">
                Ce qui va être supprimé :
              </p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>
                  La configuration de{" "}
                  <span className="font-medium text-foreground">{name}</span>{" "}
                  (prompt système, modèle, paramètres)
                </li>
                <li>Toutes ses affectations à des salons</li>
                <li>Tous les logs d&apos;audit de ses conversations</li>
                <li>Sa knowledge base RAG (chunks vectoriels)</li>
                <li>
                  <strong className="text-status-error">
                    Le compte Matrix{" "}
                    <span className="font-mono">@{slug}</span> sera désactivé
                  </strong>{" "}
                  — il ne pourra jamais être ré-utilisé
                </li>
              </ul>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="space-y-2"
            >
              <Label htmlFor="confirm-slug">
                Pour confirmer, tape le slug :{" "}
                <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                  {slug}
                </code>
              </Label>
              <Input
                id="confirm-slug"
                autoFocus
                autoComplete="off"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={slug}
                className="font-mono"
              />
            </form>

            {error && (
              <div className="rounded-lg bg-status-error/10 p-3 text-sm text-status-error">
                {error}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Annuler
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!valid || pending}
              onClick={submit}
            >
              <TrashIcon className="size-4" />
              {pending ? "Suppression..." : "Supprimer définitivement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
