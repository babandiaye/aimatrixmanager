"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AgentFormState, createAgent, updateAgent } from "./actions";
import { SHARED_OLLAMA_MODEL } from "@/lib/llm-catalog";
import type { LLMProvider } from "@prisma/client";

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
  model?: string;
  maxTokens?: number;
  temperature?: number | null;
};

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

  // Le fournisseur et le modèle ne sont plus choisis : il n'y en a qu'un.
  // On vérifie seulement que le serveur l'expose réellement — le catalogue
  // dit ce qui est AUTORISÉ, cette liste dit ce qui EXISTE.
  const modelAvailable = ollamaModels.some(
    (m) => m.name === SHARED_OLLAMA_MODEL,
  );

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

      {/* Fournisseur — un seul disponible.
          Anthropic et OpenAI reviendront adossés à la clé personnelle de
          l'enseignant. Les proposer aujourd'hui ferait consommer la clé
          de l'établissement, sans rattachement ni plafond. */}
      <div className="space-y-2">
        <Label>Fournisseur LLM</Label>
        <div className="rounded-lg border border-border p-3">
          <div className="text-sm font-medium">
            Ollama UN-CHK —{" "}
            <span className="font-mono">{SHARED_OLLAMA_MODEL}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {!ollamaEnabled
              ? "Non configuré — OLLAMA_BASE_URL et OLLAMA_API_KEY absentes du .env."
              : modelAvailable
                ? "Hébergé à l'UN-CHK. Aucune donnée ne quitte l'établissement, aucun coût par jeton."
                : `Le serveur répond mais n'expose pas ${SHARED_OLLAMA_MODEL} — l'agent ne pourra pas répondre.`}
          </div>
        </div>
        <input type="hidden" name="provider" value="OLLAMA" />
        <input type="hidden" name="model" value={SHARED_OLLAMA_MODEL} />
        {errs.provider?.[0] && (
          <p className="text-xs text-destructive">{errs.provider[0]}</p>
        )}
        {errs.model?.[0] && (
          <p className="text-xs text-destructive">{errs.model[0]}</p>
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
