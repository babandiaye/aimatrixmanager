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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  PencilSquareIcon,
  LockClosedIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  TrashIcon,
  ArrowPathIcon,
  LinkIcon,
} from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import {
  activateRoomEncryption,
  deleteRoom,
  refreshRoomMoodleLink,
  renameRoom,
} from "../actions";

export function AdminCard({
  roomId,
  matrixRoomId,
  currentName,
  isEncrypted,
  canDelete,
}: {
  roomId: string;
  matrixRoomId: string;
  currentName: string | null;
  isEncrypted: boolean;
  canDelete: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Administration</CardTitle>
            <CardDescription>
              Gestion du salon depuis AI Bot Manager — change le nom ou active
              le chiffrement E2EE.
            </CardDescription>
          </div>
          {canDelete && (
            <DeleteRoomButton
              roomId={roomId}
              matrixRoomId={matrixRoomId}
              currentName={currentName}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <RenameRow
          roomId={roomId}
          currentName={currentName}
        />
        <EncryptionRow
          roomId={roomId}
          matrixRoomId={matrixRoomId}
          isEncrypted={isEncrypted}
        />
        <RefreshMoodleLinkRow roomId={roomId} />
      </CardContent>
    </Card>
  );
}

// ─── Renommer ─────────────────────────────────────────────────────────────

function RenameRow({
  roomId,
  currentName,
}: {
  roomId: string;
  currentName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [name, setName] = useState(currentName ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName(currentName ?? "");
      setError(null);
    }
  }, [open, currentName]);

  const valid = name.trim().length > 0 && name.trim() !== (currentName ?? "");

  const submit = () => {
    if (!valid) return;
    setError(null);
    start(async () => {
      try {
        await renameRoom(roomId, name.trim());
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur");
      }
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-secondary p-2">
          <PencilSquareIcon className="size-5 text-primary" />
        </div>
        <div>
          <div className="text-sm font-medium">Nom du salon</div>
          <div className="text-xs text-muted-foreground">
            {currentName ?? "(sans nom)"}
          </div>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Renommer
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renommer le salon</DialogTitle>
            <DialogDescription>
              Le nouveau nom sera visible par tous les membres.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-3"
          >
            <div className="space-y-2">
              <Label htmlFor="room-name">Nouveau nom</Label>
              <Input
                id="room-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mathématiques L1 — TD2"
                maxLength={255}
              />
              <p className="text-xs text-muted-foreground">
                {name.length}/255 caractères
              </p>
            </div>
            {error && (
              <div className="rounded-lg bg-status-error/10 p-3 text-sm text-status-error">
                {error}
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={!valid || pending}>
                {pending ? "Enregistrement..." : "Renommer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Activer le chiffrement E2EE ──────────────────────────────────────────

function EncryptionRow({
  roomId,
  matrixRoomId,
  isEncrypted,
}: {
  roomId: string;
  matrixRoomId: string;
  isEncrypted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirm("");
      setError(null);
    }
  }, [open]);

  const expected = "ACTIVER";
  const valid = confirm.trim().toUpperCase() === expected;

  const submit = () => {
    if (!valid) return;
    setError(null);
    start(async () => {
      try {
        await activateRoomEncryption(roomId);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur");
      }
    });
  };

  if (isEncrypted) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-status-published/30 bg-status-published/5 p-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-status-published/10 p-2">
            <ShieldCheckIcon className="size-5 text-status-published" />
          </div>
          <div>
            <div className="text-sm font-medium">Chiffrement E2EE</div>
            <div className="text-xs text-muted-foreground">
              Salon protégé par Megolm — irréversible côté Matrix.
            </div>
          </div>
        </div>
        <StatusBadge status="published">actif</StatusBadge>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-secondary p-2">
          <LockClosedIcon className="size-5 text-primary" />
        </div>
        <div>
          <div className="text-sm font-medium">Chiffrement E2EE</div>
          <div className="text-xs text-muted-foreground">
            Aucun chiffrement actif. Une fois activé, c&apos;est définitif.
          </div>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Activer
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-status-error/10 p-2">
                <ExclamationTriangleIcon className="size-6 text-status-error" />
              </div>
              <div>
                <DialogTitle>Activer le chiffrement E2EE ?</DialogTitle>
                <DialogDescription>
                  Action irréversible côté Matrix
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-status-error/30 bg-status-error/5 p-3 text-sm space-y-2">
              <p className="font-medium text-foreground">
                À savoir avant d&apos;activer :
              </p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>
                  Tous les messages futurs seront chiffrés bout-en-bout (Megolm v1).
                </li>
                <li>
                  L&apos;historique antérieur reste{" "}
                  <strong>non chiffré</strong>.
                </li>
                <li>
                  Les agents IA présents pourront lire les messages postérieurs
                  (initialisation Olm automatique).
                </li>
                <li className="text-status-error font-medium">
                  Un salon chiffré ne peut <strong>jamais</strong> redevenir clair.
                </li>
              </ul>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-encrypt">
                Tape{" "}
                <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                  {expected}
                </code>{" "}
                pour confirmer
              </Label>
              <Input
                id="confirm-encrypt"
                autoFocus
                autoComplete="off"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="font-mono uppercase"
              />
            </div>
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
              <LockClosedIcon className="size-4" />
              {pending ? "Activation..." : "Activer le chiffrement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Actualiser le lien Moodle (ADMIN/MANAGER) ────────────────────────────

function RefreshMoodleLinkRow({ roomId }: { roomId: string }) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<{
    tone: "ok" | "warn" | "error";
    message: string;
  } | null>(null);
  const router = useRouter();

  const run = () => {
    setFeedback(null);
    start(async () => {
      try {
        const r = await refreshRoomMoodleLink(roomId);
        setFeedback({
          tone: r.linked ? "ok" : "warn",
          message: r.message,
        });
        router.refresh();
      } catch (e) {
        setFeedback({
          tone: "error",
          message: e instanceof Error ? e.message : "Erreur",
        });
      }
    });
  };

  const toneClasses = feedback
    ? feedback.tone === "ok"
      ? "border-status-published/30 bg-status-published/5 text-status-published"
      : feedback.tone === "warn"
        ? "border-status-processing/30 bg-status-processing/5 text-status-processing"
        : "border-status-error/30 bg-status-error/5 text-status-error"
    : "";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-secondary p-2">
            <LinkIcon className="size-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-medium">Lien Moodle & RAG</div>
            <div className="text-xs text-muted-foreground">
              Re-détecte le cours Moodle depuis Matrix et active le RAG
              automatiquement si des ressources indexables existent.
            </div>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={run}
          disabled={pending}
        >
          <ArrowPathIcon
            className={`size-4 ${pending ? "animate-spin" : ""}`}
          />
          {pending ? "Actualisation..." : "Actualiser"}
        </Button>
      </div>
      {feedback && (
        <p
          className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${toneClasses}`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}

// ─── Supprimer le salon (ADMIN uniquement) ────────────────────────────────

function DeleteRoomButton({
  roomId,
  matrixRoomId,
  currentName,
}: {
  roomId: string;
  matrixRoomId: string;
  currentName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) {
      setConfirm("");
      setError(null);
    }
  }, [open]);

  const expected = "SUPPRIMER";
  const valid = confirm.trim().toUpperCase() === expected;

  const submit = () => {
    if (!valid) return;
    setError(null);
    start(async () => {
      try {
        await deleteRoom(roomId);
        setOpen(false);
        router.push("/rooms");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur");
      }
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-status-error hover:bg-status-error/10 hover:text-status-error"
        title="Supprimer ce salon"
        aria-label="Supprimer ce salon"
        onClick={() => setOpen(true)}
      >
        <TrashIcon className="size-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-status-error/10 p-2">
                <ExclamationTriangleIcon className="size-6 text-status-error" />
              </div>
              <div>
                <DialogTitle>Supprimer le salon ?</DialogTitle>
                <DialogDescription>
                  Purge complète Matrix + AI Bot Manager
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-status-error/30 bg-status-error/5 p-3 text-sm space-y-2">
              <p className="font-medium text-foreground">
                Salon :{" "}
                <span className="font-mono">
                  {currentName ?? "(sans nom)"}
                </span>
              </p>
              <p className="text-xs text-muted-foreground font-mono break-all">
                {matrixRoomId}
              </p>
              <ul className="mt-2 list-disc list-inside space-y-1 text-muted-foreground text-xs">
                <li>
                  L&apos;historique complet est effacé côté Synapse
                  (messages, médias, keys).
                </li>
                <li>
                  Tous les membres sont éjectés — le salon disparaît
                  d&apos;Element.
                </li>
                <li>
                  Les assignations d&apos;agents et l&apos;audit trail sont
                  supprimés en cascade.
                </li>
                <li className="text-status-error font-medium">
                  Action irréversible.
                </li>
              </ul>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-delete">
                Tape{" "}
                <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                  {expected}
                </code>{" "}
                pour confirmer
              </Label>
              <Input
                id="confirm-delete"
                autoFocus
                autoComplete="off"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="font-mono uppercase"
              />
            </div>
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
