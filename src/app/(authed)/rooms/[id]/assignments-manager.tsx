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
import { TrashIcon, PlusIcon } from "@heroicons/react/24/outline";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  assignAgentToRoom,
  toggleAssignmentEnabled,
  unassignAgent,
} from "../actions";

type Agent = { id: string; slug: string; name: string; status: string };
type Assignment = { id: string; enabled: boolean; agent: Agent };

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
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
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
