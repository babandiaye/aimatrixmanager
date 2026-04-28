"use client";

import { useState, useTransition, useEffect } from "react";
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
  KeyIcon,
  CheckIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { resetUserPassword } from "./actions";

const MIN_LENGTH = 8;

export function PasswordResetDialog({
  userId,
  email,
  name,
}: {
  userId: string;
  email: string;
  name: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset des champs quand on ferme
  useEffect(() => {
    if (!open) {
      setPwd("");
      setConfirm("");
      setError(null);
    }
  }, [open]);

  const tooShort = pwd.length > 0 && pwd.length < MIN_LENGTH;
  const matches = confirm.length > 0 && pwd === confirm;
  const mismatch = confirm.length > 0 && pwd !== confirm;
  const valid = pwd.length >= MIN_LENGTH && matches;

  const submit = () => {
    if (!valid) return;
    setError(null);
    start(async () => {
      try {
        await resetUserPassword(userId, pwd);
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
        variant="outline"
        size="icon-sm"
        title="Réinitialiser le mot de passe"
        onClick={() => setOpen(true)}
      >
        <KeyIcon className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Réinitialiser le mot de passe</DialogTitle>
          <DialogDescription>
            Compte local <span className="font-mono text-xs">{email}</span>
            {name && ` — ${name}`}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="new-pwd">Nouveau mot de passe</Label>
            <Input
              id="new-pwd"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              required
            />
            <div className="flex items-center gap-1.5 text-xs">
              {tooShort ? (
                <>
                  <XMarkIcon className="size-3.5 text-status-error" />
                  <span className="text-status-error">
                    Au moins {MIN_LENGTH} caractères
                  </span>
                </>
              ) : pwd.length >= MIN_LENGTH ? (
                <>
                  <CheckIcon className="size-3.5 text-status-published" />
                  <span className="text-status-published">
                    Longueur OK
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  Au moins {MIN_LENGTH} caractères
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-pwd">Confirmer</Label>
            <Input
              id="confirm-pwd"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            <div className="flex items-center gap-1.5 text-xs">
              {mismatch ? (
                <>
                  <XMarkIcon className="size-3.5 text-status-error" />
                  <span className="text-status-error">
                    Les mots de passe ne correspondent pas
                  </span>
                </>
              ) : matches ? (
                <>
                  <CheckIcon className="size-3.5 text-status-published" />
                  <span className="text-status-published">
                    Mots de passe identiques
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  Saisis le même mot de passe
                </span>
              )}
            </div>
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
              {pending ? "Enregistrement..." : "Réinitialiser"}
            </Button>
          </DialogFooter>
        </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
