"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  TrashIcon,
  PlusIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  assignAgentToRoom,
  manualRejoinAgent,
  resetRejoinFailCount,
  toggleAssignmentEnabled,
  toggleAutoRejoinOnKick,
  unassignAgent,
} from "../actions";

type Agent = { id: string; slug: string; name: string; status: string };
type Assignment = {
  id: string;
  enabled: boolean;
  autoRejoinOnKick: boolean;
  rejoinFailCount: number;
  agent: Agent;
};

export function AssignmentsManager({
  roomId,
  assignments,
  availableAgents,
  canAssign,
}: {
  roomId: string;
  assignments: Assignment[];
  availableAgents: Agent[];
  canAssign: boolean;
}) {
  const [pending, start] = useTransition();
  const [selectedAgent, setSelectedAgent] = useState<string>("");

  return (
    <div className="space-y-4">
      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun agent assigné à ce salon.
        </p>
      ) : (
        <ul className="space-y-2">
          {assignments.map((a) => (
            <li
              key={a.id}
              className="space-y-3 rounded-lg border border-border p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <StatusBadge
                    status={a.agent.status === "ENABLED" ? "published" : "unpublished"}
                    className="font-mono text-[10px]"
                  >
                    @{a.agent.slug}
                  </StatusBadge>
                  <div>
                    <div className="text-sm font-medium">{a.agent.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Statut agent : {a.agent.status}
                    </div>
                  </div>
                </div>
                {canAssign && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {a.enabled ? "actif ici" : "inactif ici"}
                    </span>
                    <Switch
                      checked={a.enabled}
                      disabled={pending}
                      onCheckedChange={(next) => {
                        start(async () => {
                          try {
                            await toggleAssignmentEnabled(a.id, next);
                          } catch (e) {
                            alert(e instanceof Error ? e.message : "Erreur");
                          }
                        });
                      }}
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-sm"
                      disabled={pending}
                      title="Retirer cet agent du salon"
                      onClick={() => {
                        if (!confirm(`Retirer @${a.agent.slug} de ce salon ?`))
                          return;
                        start(async () => {
                          try {
                            await unassignAgent(a.id);
                          } catch (e) {
                            alert(e instanceof Error ? e.message : "Erreur");
                          }
                        });
                      }}
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  </div>
                )}
              </div>

              {canAssign && (
                <div className="space-y-2 border-t border-border pt-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="font-medium text-foreground">
                        Auto-rejoin si kické du salon
                      </div>
                      <div className="text-muted-foreground">
                        Si un admin Matrix expulse @{a.agent.slug}, le bot
                        retente automatiquement le join (cooldown 5 min,
                        désactivation auto après 3 échecs).
                      </div>
                    </div>
                    <Switch
                      checked={a.autoRejoinOnKick}
                      disabled={pending}
                      onCheckedChange={(next) => {
                        start(async () => {
                          try {
                            await toggleAutoRejoinOnKick(a.id, next);
                          } catch (e) {
                            alert(e instanceof Error ? e.message : "Erreur");
                          }
                        });
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {a.rejoinFailCount > 0 ? (
                      <div className="inline-flex items-center gap-2 rounded-md bg-status-error/10 px-2 py-1 text-status-error">
                        <ExclamationTriangleIcon className="size-3.5" />
                        <span>
                          {a.rejoinFailCount} échec(s) consécutif(s) de rejoin
                        </span>
                        <button
                          type="button"
                          className="underline hover:opacity-80 disabled:opacity-50"
                          disabled={pending}
                          onClick={() => {
                            start(async () => {
                              try {
                                await resetRejoinFailCount(a.id);
                              } catch (e) {
                                alert(
                                  e instanceof Error ? e.message : "Erreur",
                                );
                              }
                            });
                          }}
                        >
                          Réinitialiser
                        </button>
                      </div>
                    ) : (
                      <span /> /* placeholder pour aligner le bouton à droite */
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      title={`Force @${a.agent.slug} à rejoindre ce salon via Synapse Admin (idempotent).`}
                      onClick={() => {
                        if (
                          !confirm(
                            `Faire rejoindre @${a.agent.slug} dans ce salon maintenant ?\n\nL'assignation sera (ré)activée et le compteur d'échecs remis à zéro.`,
                          )
                        )
                          return;
                        start(async () => {
                          try {
                            await manualRejoinAgent(a.id);
                          } catch (e) {
                            alert(e instanceof Error ? e.message : "Erreur");
                          }
                        });
                      }}
                    >
                      <ArrowPathIcon className="size-3.5" />
                      Rejoindre maintenant
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canAssign && availableAgents.length > 0 && (
        <div className="flex items-end gap-2 border-t border-border pt-4">
          <div className="flex-1">
            <Select
              value={selectedAgent}
              onValueChange={(v) => v && setSelectedAgent(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choisir un agent à assigner..." />
              </SelectTrigger>
              <SelectContent>
                {availableAgents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    @{a.slug} — {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            disabled={!selectedAgent || pending}
            onClick={() => {
              if (!selectedAgent) return;
              const id = selectedAgent;
              start(async () => {
                try {
                  await assignAgentToRoom(roomId, id);
                  setSelectedAgent("");
                } catch (e) {
                  alert(e instanceof Error ? e.message : "Erreur");
                }
              });
            }}
          >
            <PlusIcon className="size-4" />
            Assigner
          </Button>
        </div>
      )}
      {canAssign && availableAgents.length === 0 && assignments.length > 0 && (
        <p className="text-xs text-muted-foreground border-t border-border pt-3">
          Tous les agents disponibles sont déjà assignés à ce salon.
        </p>
      )}
    </div>
  );
}
