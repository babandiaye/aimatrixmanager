"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ExclamationTriangleIcon,
  TrashIcon,
  PlayIcon,
  PauseIcon,
  NoSymbolIcon,
} from "@heroicons/react/24/outline";
import { bulkDeleteAgents, bulkSetAgentStatus, type BulkResult } from "./actions";

/**
 * Sélection multiple sur la liste des agents.
 *
 * Le provider est un composant client qui enveloppe le contenu rendu côté
 * serveur : les cases à cocher et la barre d'actions consomment le contexte,
 * le tableau lui-même reste un Server Component. Ça évite de faire
 * transiter toutes les données des agents en props côté client.
 *
 * La sélection est volontairement limitée à la page courante — la
 * pagination remonte le composant, donc la sélection se vide en changeant
 * de page. C'est le comportement attendu : on ne veut pas supprimer des
 * agents qu'on n'a plus sous les yeux.
 */

type SelectionContextValue = {
  selected: Set<string>;
  toggle: (id: string) => void;
  toggleAll: (ids: string[]) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) {
    throw new Error("Composant de sélection utilisé hors de AgentSelectionProvider");
  }
  return ctx;
}

export function AgentSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Tout cocher, sauf si tout est déjà coché → on décoche tout.
  const toggleAll = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const allChecked = ids.length > 0 && ids.every((id) => prev.has(id));
      return allChecked ? new Set() : new Set(ids);
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);
  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const value = useMemo(
    () => ({ selected, toggle, toggleAll, clear, isSelected }),
    [selected, toggle, toggleAll, clear, isSelected],
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

const CHECKBOX_CLASS =
  "size-4 cursor-pointer rounded border-border accent-primary disabled:cursor-not-allowed disabled:opacity-40";

export function AgentRowCheckbox({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const { isSelected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      className={CHECKBOX_CLASS}
      checked={isSelected(id)}
      onChange={() => toggle(id)}
      aria-label={`Sélectionner l'agent ${label}`}
    />
  );
}

export function AgentSelectAllCheckbox({ ids }: { ids: string[] }) {
  const { selected, toggleAll } = useSelection();
  const allChecked = ids.length > 0 && ids.every((id) => selected.has(id));
  const someChecked = ids.some((id) => selected.has(id));

  return (
    <input
      type="checkbox"
      className={CHECKBOX_CLASS}
      checked={allChecked}
      // Cases partiellement cochées : l'état indéterminé n'est pas
      // exprimable en JSX, il se pose sur le nœud DOM.
      ref={(el) => {
        if (el) el.indeterminate = someChecked && !allChecked;
      }}
      onChange={() => toggleAll(ids)}
      aria-label="Tout sélectionner sur cette page"
    />
  );
}

/**
 * Barre d'actions groupées. Masquée tant que rien n'est sélectionné, pour
 * ne pas encombrer la page dans l'usage courant.
 */
export function AgentBulkBar({ canUpdate, canDelete }: {
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const { selected, clear } = useSelection();
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const router = useRouter();

  const ids = useMemo(() => [...selected], [selected]);
  const count = ids.length;

  if (count === 0) return null;

  const report = (r: BulkResult, verb: string) => {
    if (r.failed.length === 0) {
      alert(`${r.ok} agent(s) ${verb}.`);
    } else {
      const details = r.failed
        .map((f) => `- ${f.label} : ${f.error}`)
        .join("\n");
      alert(
        `${r.ok} agent(s) ${verb}, ${r.failed.length} en échec :\n${details}`,
      );
    }
    clear();
    router.refresh();
  };

  const runStatus = (status: "ENABLED" | "DISABLED" | "SUSPENDED", verb: string) => {
    start(async () => {
      try {
        report(await bulkSetAgentStatus(ids, status), verb);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Erreur");
      }
    });
  };

  const runDelete = () => {
    start(async () => {
      try {
        const r = await bulkDeleteAgents(ids);
        setConfirmDelete(false);
        setConfirmText("");
        report(r, "supprimé(s)");
      } catch (e) {
        alert(e instanceof Error ? e.message : "Erreur");
      }
    });
  };

  const expected = "SUPPRIMER";
  const confirmValid = confirmText.trim().toUpperCase() === expected;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
      <span className="text-sm font-medium">
        {count} agent{count > 1 ? "s" : ""} sélectionné{count > 1 ? "s" : ""}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {canUpdate && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => runStatus("ENABLED", "activé(s)")}
            >
              <PlayIcon className="size-4" />
              Activer
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => runStatus("DISABLED", "désactivé(s)")}
            >
              <PauseIcon className="size-4" />
              Désactiver
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => runStatus("SUSPENDED", "suspendu(s)")}
            >
              <NoSymbolIcon className="size-4" />
              Suspendre
            </Button>
          </>
        )}
        {canDelete && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
          >
            <TrashIcon className="size-4" />
            Supprimer
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={clear}
        >
          Annuler
        </Button>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-status-error/10 p-2">
                <ExclamationTriangleIcon className="size-6 text-status-error" />
              </div>
              <div>
                <DialogTitle>
                  Supprimer {count} agent{count > 1 ? "s" : ""} ?
                </DialogTitle>
                <DialogDescription>Action irréversible</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-status-error/30 bg-status-error/5 p-3 text-xs space-y-1 text-muted-foreground">
              <p>Pour chaque agent sélectionné :</p>
              <ul className="list-inside list-disc space-y-1">
                <li>son compte Matrix est désactivé côté Synapse ;</li>
                <li>ses affectations aux salons sont supprimées ;</li>
                <li>
                  il cesse immédiatement de répondre dans tous ses salons.
                </li>
              </ul>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-bulk-delete">
                Tape{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {expected}
                </code>{" "}
                pour confirmer
              </Label>
              <Input
                id="confirm-bulk-delete"
                autoFocus
                autoComplete="off"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="font-mono uppercase"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmDelete(false)}
            >
              Annuler
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!confirmValid || pending}
              onClick={runDelete}
            >
              <TrashIcon className="size-4" />
              {pending ? "Suppression..." : "Supprimer définitivement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
