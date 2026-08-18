"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AgentFormState, createAgent, updateAgent } from "./actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LLMProvider } from "@prisma/client";

export type LlmChoice = {
  id: string;
  name: string;
  provider: string;
  model: string;
  scope: string;
  isDefault: boolean;
};

const PROVIDER_LABEL: Record<string, string> = {
  ANTHROPIC: "Anthropic Claude",
  OPENAI: "OpenAI ChatGPT",
  OLLAMA: "Ollama UN-CHK",
};

type Initial = {
  id?: string;
  slug?: string;
  name?: string;
  description?: string | null;
  systemPrompt?: string;
  // Type Prisma plutôt qu'une union figée : l'enum gagne des valeurs
  // (OPENAI) au fil des phases, et le formulaire reçoit ce que la base
  // contient — y compris pour des agents créés avant la restriction.
  provider?: LLMProvider;
  llmConfigId?: string | null;
  model?: string;
  maxTokens?: number;
  temperature?: number | null;
};

export function AgentForm({
  initial,
  serverName,
  llmChoices,
  defaultLlmConfigId,
}: {
  initial?: Initial;
  serverName: string;
  llmChoices: LlmChoice[];
  defaultLlmConfigId: string | null;
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

  // Configuration retenue : celle de l'agent s'il en a une, sinon le défaut
  // personnel, sinon le défaut d'usine partagé. Le serveur refait la même
  // résolution — l'affichage ne fait que la refléter.
  const fallbackId =
    defaultLlmConfigId ??
    llmChoices.find((c) => c.scope === "SHARED" && c.isDefault)?.id ??
    llmChoices[0]?.id ??
    "";
  const [llmConfigId, setLlmConfigId] = useState(
    initial?.llmConfigId ?? fallbackId,
  );
  const chosen = llmChoices.find((c) => c.id === llmConfigId) ?? null;

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
        </p>
        {errs.systemPrompt?.[0] && (
          <p className="text-xs text-destructive">{errs.systemPrompt[0]}</p>
        )}
      </div>

      {/* Fournisseur : on désigne une configuration, pas un couple
          (fournisseur, modèle). Le serveur en dérive le reste, ce qui rend
          une combinaison incohérente impossible à envoyer à la main. */}
      <div className="space-y-2">
        <Label htmlFor="llmConfigId">Fournisseur LLM</Label>
        <Select
          name="llmConfigId"
          value={llmConfigId}
          onValueChange={(v) => v && setLlmConfigId(v)}
        >
          <SelectTrigger id="llmConfigId" className="w-full">
            <SelectValue placeholder="Choisir un fournisseur…" />
          </SelectTrigger>
          <SelectContent>
            {llmChoices.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name} — {c.model}
                {c.scope === "SHARED" ? " (établissement)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {chosen?.scope === "PERSONAL" ? (
            <>
              <strong>{PROVIDER_LABEL[chosen.provider] ?? chosen.provider}</strong>{" "}
              avec votre clé personnelle — chaque message de vos étudiants vous
              sera facturé par le fournisseur.
            </>
          ) : (
            <>
              Hébergé à l&apos;UN-CHK. Aucune donnée ne quitte
              l&apos;établissement, aucun coût par jeton.{" "}
              <Link href="/llm" className="underline">
                Déclarer ma propre clé
              </Link>
            </>
          )}
        </p>
        {errs.llmConfigId?.[0] && (
          <p className="text-xs text-destructive">{errs.llmConfigId[0]}</p>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-3">
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
          0 = déterministe, 1 = créatif. Vide = défaut.
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
