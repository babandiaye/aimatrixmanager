"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type AgentFormState, createAgent, updateAgent } from "./actions";

type Initial = {
  id?: string;
  slug?: string;
  name?: string;
  description?: string | null;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number | null;
};

const MODELS = [
  { value: "claude-opus-4-7", label: "Claude Opus 4.7 (le + capable)" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (équilibré)" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (rapide & éco)" },
];

export function AgentForm({
  initial,
  serverName,
}: {
  initial?: Initial;
  serverName: string;
}) {
  const isEdit = Boolean(initial?.id);
  const action = isEdit
    ? updateAgent.bind(null, initial!.id!)
    : createAgent;

  const [state, formAction, pending] = useActionState<
    AgentFormState,
    FormData
  >(action, undefined);
  const errs = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="slug">
            Slug Matrix <span className="text-destructive">*</span>
          </Label>
          <div className="flex items-center gap-1 font-mono text-sm">
            <span className="text-muted-foreground">@</span>
            <Input
              id="slug"
              name="slug"
              defaultValue={initial?.slug ?? ""}
              placeholder="kocc-barma"
              required
              readOnly={isEdit}
              className="font-mono"
            />
            <span className="text-muted-foreground">:{serverName}</span>
          </div>
          {isEdit ? (
            <p className="text-xs text-muted-foreground">
              Le slug est figé après création (lié à l&apos;identité Matrix).
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Identifiant Matrix de l&apos;agent. Sera mentionné par les
              étudiants : <code>@slug …</code>
            </p>
          )}
          {errs.slug?.[0] && (
            <p className="text-xs text-destructive">{errs.slug[0]}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">
            Nom affiché <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            name="name"
            defaultValue={initial?.name ?? ""}
            placeholder="Kocc Barma — Assistant IA"
            required
          />
          {errs.name?.[0] && (
            <p className="text-xs text-destructive">{errs.name[0]}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description (optionnel)</Label>
        <Input
          id="description"
          name="description"
          defaultValue={initial?.description ?? ""}
          placeholder="Tuteur pédagogique pour les cours de programmation"
        />
        <p className="text-xs text-muted-foreground">
          Visible dans la liste des agents (pas dans Matrix).
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="systemPrompt">
          Prompt système <span className="text-destructive">*</span>
        </Label>
        <textarea
          id="systemPrompt"
          name="systemPrompt"
          defaultValue={initial?.systemPrompt ?? ""}
          rows={10}
          className="w-full rounded-lg border border-input bg-transparent p-3 text-sm font-mono outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          placeholder="Tu es Kocc Barma, un assistant pédagogique..."
          required
        />
        <p className="text-xs text-muted-foreground">
          Définit la personnalité et les règles que l&apos;agent suit.
          Utilisé comme <code>system</code> dans l&apos;API Anthropic.
        </p>
        {errs.systemPrompt?.[0] && (
          <p className="text-xs text-destructive">{errs.systemPrompt[0]}</p>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="model">Modèle Claude</Label>
          <Select name="model" defaultValue={initial?.model ?? "claude-sonnet-4-6"}>
            <SelectTrigger id="model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="maxTokens">Max tokens</Label>
          <Input
            id="maxTokens"
            name="maxTokens"
            type="number"
            min={64}
            max={8192}
            step={64}
            defaultValue={initial?.maxTokens ?? 2048}
          />
          {errs.maxTokens?.[0] && (
            <p className="text-xs text-destructive">{errs.maxTokens[0]}</p>
          )}
        </div>
      </div>

      <div className="space-y-2 md:max-w-xs">
        <Label htmlFor="temperature">Temperature (optionnel)</Label>
        <Input
          id="temperature"
          name="temperature"
          type="number"
          min={0}
          max={1}
          step={0.05}
          defaultValue={initial?.temperature ?? ""}
          placeholder="(par défaut du modèle)"
        />
        <p className="text-xs text-muted-foreground">
          0 = déterministe, 1 = créatif. Laisse vide pour le défaut.
        </p>
      </div>

      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
        <Link href="/agents" className={buttonVariants({ variant: "ghost" })}>
          Annuler
        </Link>
        <Button type="submit" disabled={pending}>
          {pending
            ? "Enregistrement..."
            : isEdit
              ? "Enregistrer"
              : "Créer l'agent"}
        </Button>
      </div>
    </form>
  );
}
