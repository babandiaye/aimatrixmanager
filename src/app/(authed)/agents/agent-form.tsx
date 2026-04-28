"use client";

import { useActionState, useState } from "react";
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
  provider?: "ANTHROPIC" | "OLLAMA";
  model?: string;
  maxTokens?: number;
  temperature?: number | null;
};

const ANTHROPIC_MODELS = [
  { value: "claude-opus-4-7", label: "Claude Opus 4.7 (le + capable, US)" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (équilibré, US)" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (rapide & éco, US)" },
];

export function AgentForm({
  initial,
  serverName,
  ollamaModels,
  ollamaEnabled,
}: {
  initial?: Initial;
  serverName: string;
  ollamaModels: { name: string; size: number; parameter_size?: string }[];
  ollamaEnabled: boolean;
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

  const [provider, setProvider] = useState<"ANTHROPIC" | "OLLAMA">(
    initial?.provider ?? "ANTHROPIC",
  );

  // Modèle initial : on prend celui en cours si présent, sinon défaut du provider
  const defaultAnthropicModel =
    initial?.provider === "ANTHROPIC" && initial?.model
      ? initial.model
      : "claude-sonnet-4-6";
  const defaultOllamaModel =
    initial?.provider === "OLLAMA" && initial?.model
      ? initial.model
      : (ollamaModels[0]?.name ?? "");

  const [anthropicModel, setAnthropicModel] = useState(defaultAnthropicModel);
  const [ollamaModel, setOllamaModel] = useState(defaultOllamaModel);

  const fmtSize = (n: number) =>
    n < 1e9 ? `${(n / 1e6).toFixed(0)} MB` : `${(n / 1e9).toFixed(1)} GB`;

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

      {/* Choix Provider */}
      <div className="space-y-2">
        <Label>Fournisseur LLM</Label>
        <div className="grid gap-2 md:grid-cols-2">
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
              provider === "ANTHROPIC"
                ? "border-primary bg-secondary"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <input
              type="radio"
              name="provider"
              value="ANTHROPIC"
              checked={provider === "ANTHROPIC"}
              onChange={() => setProvider("ANTHROPIC")}
              className="mt-1"
            />
            <div>
              <div className="text-sm font-medium">Anthropic Claude</div>
              <div className="text-xs text-muted-foreground">
                API US, qualité top tier (Opus / Sonnet / Haiku). Coût par token.
              </div>
            </div>
          </label>
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
              !ollamaEnabled
                ? "opacity-50 cursor-not-allowed"
                : provider === "OLLAMA"
                  ? "border-primary bg-secondary"
                  : "border-border hover:bg-muted/50"
            }`}
          >
            <input
              type="radio"
              name="provider"
              value="OLLAMA"
              checked={provider === "OLLAMA"}
              onChange={() => setProvider("OLLAMA")}
              disabled={!ollamaEnabled}
              className="mt-1"
            />
            <div>
              <div className="text-sm font-medium">Ollama souverain</div>
              <div className="text-xs text-muted-foreground">
                {ollamaEnabled
                  ? `${ollamaModels.length} modèle(s) on-prem (UN-CHK). Privacy + zéro coût/token.`
                  : "Non configuré (OLLAMA_BASE_URL/API_KEY manquants)"}
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Modèle dynamique selon provider — un seul `name="model"` actif à la fois */}
      <div className="grid gap-5 md:grid-cols-3">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="model">Modèle</Label>
          {provider === "ANTHROPIC" ? (
            <>
              <Select
                name="model"
                value={anthropicModel}
                onValueChange={(v) => v && setAnthropicModel(v)}
              >
                <SelectTrigger id="model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANTHROPIC_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : (
            <>
              <Select
                name="model"
                value={ollamaModel}
                onValueChange={(v) => v && setOllamaModel(v)}
              >
                <SelectTrigger id="model" className="w-full">
                  <SelectValue placeholder="Choisir un modèle..." />
                </SelectTrigger>
                <SelectContent>
                  {ollamaModels.map((m) => (
                    <SelectItem key={m.name} value={m.name}>
                      {m.name}
                      {m.parameter_size && ` — ${m.parameter_size}`} (
                      {fmtSize(m.size)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {errs.model?.[0] && (
            <p className="text-xs text-destructive">{errs.model[0]}</p>
          )}
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
