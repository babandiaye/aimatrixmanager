"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createLlmConfig,
  deleteLlmConfig,
  probeLlmKey,
  setDefaultLlm,
  setSharedDefault,
  toggleLlmActive,
  type LlmFormState,
} from "./actions";

type Config = {
  id: string;
  name: string;
  provider: string;
  apiUrl: string | null;
  model: string;
  scope: string;
  userId: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  isMine: boolean;
};

const PROVIDER_LABEL: Record<string, string> = {
  ANTHROPIC: "Anthropic Claude",
  OPENAI: "OpenAI ChatGPT",
  OLLAMA: "Ollama UN-CHK",
};

const KEY_PLACEHOLDER: Record<string, string> = {
  ANTHROPIC: "sk-ant-api03-…",
  OPENAI: "sk-proj-…",
};

export function LlmClient({
  configs,
  defaultLlmConfigId,
  canManageShared,
}: {
  configs: Config[];
  defaultLlmConfigId: string | null;
  canManageShared: boolean;
}) {
  const shared = configs.filter((c) => c.scope === "SHARED");
  const mine = configs.filter((c) => c.scope === "PERSONAL");
  const factory = shared.find((c) => c.isDefault && c.isActive) ?? null;

  return (
    <div className="space-y-6">
      <DefaultCard
        configs={configs}
        defaultLlmConfigId={defaultLlmConfigId}
        factory={factory}
      />
      <AddCard />
      <ListCard
        title="Mes fournisseurs"
        description="Vos clés personnelles. Personne d'autre ne les voit, pas même un administrateur."
        items={mine}
        empty="Aucun fournisseur personnel. Vos agents utilisent celui de l'établissement."
        defaultLlmConfigId={defaultLlmConfigId}
        canManageShared={canManageShared}
      />
      <ListCard
        title="Fournisseur de l'établissement"
        description="Catalogue commun, géré par l'administration. Hébergé à l'UN-CHK, sans coût par jeton."
        items={shared}
        empty="Aucun fournisseur partagé actif — contactez un administrateur."
        defaultLlmConfigId={defaultLlmConfigId}
        canManageShared={canManageShared}
      />
    </div>
  );
}

/* ── Mon défaut ─────────────────────────────────────────────────────── */

function DefaultCard({
  configs,
  defaultLlmConfigId,
  factory,
}: {
  configs: Config[];
  defaultLlmConfigId: string | null;
  factory: Config | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<LlmFormState>(undefined);
  const usable = configs.filter((c) => c.isActive);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mon fournisseur par défaut</CardTitle>
        <CardDescription>
          Utilisé par les agents que vous créez, sauf choix contraire à la
          création de l&apos;agent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={defaultLlmConfigId ?? "__factory__"}
            onValueChange={(v) =>
              start(async () => {
                setMsg(await setDefaultLlm(v === "__factory__" ? null : v));
              })
            }
          >
            <SelectTrigger className="w-full sm:w-96">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__factory__">
                {factory
                  ? `${factory.name} — ${factory.model} (établissement)`
                  : "Fournisseur de l'établissement"}
              </SelectItem>
              {usable
                .filter((c) => c.scope === "PERSONAL")
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} — {c.model} ({PROVIDER_LABEL[c.provider] ?? c.provider})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {pending && (
            <span className="text-xs text-muted-foreground">Enregistrement…</span>
          )}
        </div>
        <Feedback state={msg} />
      </CardContent>
    </Card>
  );
}

/* ── Ajout d'un fournisseur ─────────────────────────────────────────── */

function AddCard() {
  const [state, formAction, pending] = useActionState<LlmFormState, FormData>(
    createLlmConfig,
    undefined,
  );
  const [provider, setProvider] = useState("ANTHROPIC");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[] | null>(null);
  const [model, setModel] = useState("");
  const [probing, setProbing] = useState(false);
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const errs = state?.fieldErrors ?? {};

  async function onProbe() {
    setProbing(true);
    setProbeErr(null);
    setModels(null);
    const res = await probeLlmKey(provider, apiKey);
    setProbing(false);
    if (res.ok) {
      setModels(res.models);
      setModel(res.models[0] ?? "");
    } else {
      setProbeErr(res.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ajouter mon fournisseur</CardTitle>
        <CardDescription>
          Votre clé est chiffrée avant stockage et n&apos;est jamais réaffichée.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Facturation.</strong> Cette clé
            sera utilisée à chaque message envoyé par vos étudiants dans les
            salons de vos agents. La consommation vous est facturée directement
            par le fournisseur, pas par l&apos;établissement.
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Nom</Label>
              <Input
                id="name"
                name="name"
                placeholder="Ma clé Claude"
                required
                maxLength={60}
              />
              <FieldError msgs={errs.name} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider">Fournisseur</Label>
              <Select
                name="provider"
                value={provider}
                onValueChange={(v) => {
                  if (!v) return;
                  setProvider(v);
                  setModels(null);
                  setModel("");
                  setProbeErr(null);
                }}
              >
                <SelectTrigger id="provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANTHROPIC">Anthropic Claude</SelectItem>
                  <SelectItem value="OPENAI">OpenAI ChatGPT</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiKey">Clé API</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="apiKey"
                name="apiKey"
                type="password"
                autoComplete="off"
                placeholder={KEY_PLACEHOLDER[provider] ?? ""}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setModels(null);
                  setModel("");
                }}
                required
              />
              <Button
                type="button"
                variant="secondary"
                onClick={onProbe}
                disabled={probing || apiKey.length < 20}
                className="shrink-0"
              >
                {probing ? "Test en cours…" : "Tester la connexion"}
              </Button>
            </div>
            <FieldError msgs={errs.apiKey} />
            {probeErr && <p className="text-xs text-destructive">{probeErr}</p>}
            {models && (
              <p className="text-xs text-status-ok">
                Clé valide — {models.length} modèle(s) accessible(s).
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="model">Modèle</Label>
            {models ? (
              <Select name="model" value={model} onValueChange={(v) => v && setModel(v)}>
                <SelectTrigger id="model" className="w-full sm:w-96">
                  <SelectValue placeholder="Choisir un modèle…" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">
                Testez d&apos;abord la connexion — la liste des modèles vient du
                fournisseur, pour éviter les fautes de frappe.
              </p>
            )}
            <FieldError msgs={errs.model} />
          </div>

          <Feedback state={state} />

          <div className="flex justify-end border-t border-border pt-4">
            <Button type="submit" disabled={pending || !models || !model}>
              {pending ? "Enregistrement…" : "Ajouter"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Listes ─────────────────────────────────────────────────────────── */

function ListCard({
  title,
  description,
  items,
  empty,
  defaultLlmConfigId,
  canManageShared,
}: {
  title: string;
  description: string;
  items: Config[];
  empty: string;
  defaultLlmConfigId: string | null;
  canManageShared: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((c) => (
              <Row
                key={c.id}
                c={c}
                isMyDefault={c.id === defaultLlmConfigId}
                canManageShared={canManageShared}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  c,
  isMyDefault,
  canManageShared,
}: {
  c: Config;
  isMyDefault: boolean;
  canManageShared: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<LlmFormState>(undefined);
  const isShared = c.scope === "SHARED";
  const locked = isShared && c.isDefault && c.isActive;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{c.name}</span>
          <Tag tone={isShared ? "neutral" : "accent"}>
            {isShared ? "Partagé" : "Perso"}
          </Tag>
          {isMyDefault && <Tag tone="ok">Mon défaut</Tag>}
          {locked && <Tag tone="neutral">Défaut plateforme</Tag>}
          {!c.isActive && <Tag tone="warn">Désactivé</Tag>}
        </div>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
          {PROVIDER_LABEL[c.provider] ?? c.provider} · {c.model}
        </p>
        <Feedback state={msg} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isShared && canManageShared && !c.isDefault && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => start(async () => setMsg(await setSharedDefault(c.id)))}
          >
            Définir par défaut
          </Button>
        )}
        {(c.isMine || (isShared && canManageShared)) && !locked && (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => start(async () => setMsg(await toggleLlmActive(c.id)))}
            >
              {c.isActive ? "Désactiver" : "Réactiver"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (!confirm(`Supprimer « ${c.name} » ?`)) return;
                  setMsg(await deleteLlmConfig(c.id));
                })
              }
            >
              Supprimer
            </Button>
          </>
        )}
        {locked && (
          <span className="text-xs text-muted-foreground">Verrouillé</span>
        )}
      </div>
    </li>
  );
}

/* ── Bricoles ───────────────────────────────────────────────────────── */

function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "neutral" | "accent" | "ok" | "warn";
}) {
  const cls = {
    neutral: "bg-muted text-muted-foreground",
    accent: "bg-secondary text-secondary-foreground",
    ok: "bg-status-ok/15 text-status-ok",
    warn: "bg-status-warn/15 text-status-warn",
  }[tone];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[0.65rem] font-medium ${cls}`}>
      {children}
    </span>
  );
}

function FieldError({ msgs }: { msgs?: string[] }) {
  if (!msgs?.[0]) return null;
  return <p className="text-xs text-destructive">{msgs[0]}</p>;
}

function Feedback({ state }: { state: LlmFormState }) {
  if (!state) return null;
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-status-ok">{state.ok}</p>;
  return null;
}
