"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  type PlatformFormState,
  createPlatform,
  updatePlatform,
} from "./actions";

type Initial = {
  id?: string;
  key?: string;
  name?: string;
  baseUrl?: string;
  wsUsername?: string | null;
  enabled?: boolean;
};

export function PlatformForm({ initial }: { initial?: Initial }) {
  const isEdit = Boolean(initial?.id);
  const action = isEdit
    ? updatePlatform.bind(null, initial!.id!)
    : createPlatform;

  const [state, formAction, pending] = useActionState<
    PlatformFormState,
    FormData
  >(action, undefined);

  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const errs = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="key">
            Clé <span className="text-destructive">*</span>
          </Label>
          <Input
            id="key"
            name="key"
            defaultValue={initial?.key ?? ""}
            placeholder="DISI"
            required
            className="font-mono uppercase"
          />
          <p className="text-xs text-muted-foreground">
            Identifiant court (DISI, P11STN…) — majuscules, chiffres, _, -
          </p>
          {errs.key?.[0] && (
            <p className="text-xs text-destructive">{errs.key[0]}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">
            Nom <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            name="name"
            defaultValue={initial?.name ?? ""}
            placeholder="Moodle DISI"
            required
          />
          {errs.name?.[0] && (
            <p className="text-xs text-destructive">{errs.name[0]}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="baseUrl">
          URL de base <span className="text-destructive">*</span>
        </Label>
        <Input
          id="baseUrl"
          name="baseUrl"
          type="url"
          defaultValue={initial?.baseUrl ?? ""}
          placeholder="https://moodle.disi.unchk.sn"
          required
        />
        <p className="text-xs text-muted-foreground">
          Sans le slash final. Endpoint utilisé : {`{baseUrl}/webservice/rest/server.php`}
        </p>
        {errs.baseUrl?.[0] && (
          <p className="text-xs text-destructive">{errs.baseUrl[0]}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="wsToken">
          Token Web Services{" "}
          {!isEdit && <span className="text-destructive">*</span>}
        </Label>
        <Input
          id="wsToken"
          name="wsToken"
          type="password"
          autoComplete="off"
          placeholder={
            isEdit ? "(laisser vide pour conserver l'actuel)" : "Token Moodle"
          }
          required={!isEdit}
        />
        <p className="text-xs text-muted-foreground">
          Récupéré dans Moodle &gt; Site administration &gt; Plugins &gt; Web
          services &gt; Manage tokens.
        </p>
        {errs.wsToken?.[0] && (
          <p className="text-xs text-destructive">{errs.wsToken[0]}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="wsUsername">Username service (optionnel)</Label>
        <Input
          id="wsUsername"
          name="wsUsername"
          defaultValue={initial?.wsUsername ?? ""}
          placeholder="ws_aibotmanager"
        />
        <p className="text-xs text-muted-foreground">
          Login du compte service côté Moodle, utilisé pour traçabilité.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border p-4">
        <div className="space-y-0.5">
          <Label htmlFor="enabled" className="text-sm font-medium">
            Plateforme active
          </Label>
          <p className="text-xs text-muted-foreground">
            Si désactivée, la sync Moodle l&apos;ignore.
          </p>
        </div>
        <input
          type="hidden"
          name="enabled"
          value={enabled ? "on" : ""}
        />
        <Switch
          id="enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <div className="flex items-center justify-end gap-3">
        <Link href="/moodle" className={buttonVariants({ variant: "ghost" })}>
          Annuler
        </Link>
        <Button type="submit" disabled={pending}>
          {pending
            ? "Enregistrement..."
            : isEdit
              ? "Enregistrer"
              : "Créer la plateforme"}
        </Button>
      </div>
    </form>
  );
}
