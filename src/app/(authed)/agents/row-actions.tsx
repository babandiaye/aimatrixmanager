"use client";

import Link from "next/link";
import { useTransition } from "react";
import type { AgentStatus } from "@prisma/client";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PencilSquareIcon,
  ArrowPathIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import {
  rotateAgentToken,
  setAgentStatus,
  signAgentDeviceAction,
} from "./actions";
import { AgentDeleteDialog } from "./agent-delete-dialog";

export function AgentRowActions({
  id,
  slug,
  name,
  status,
  canUpdate,
  canDelete,
  xsState,
}: {
  id: string;
  slug: string;
  name: string;
  status: AgentStatus;
  canUpdate: boolean;
  canDelete: boolean;
  xsState: "verified" | "partial" | "missing";
}) {
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center justify-end gap-2">
      {canUpdate && (
        <>
          <Select
            value={status}
            disabled={pending}
            onValueChange={(next) => {
              if (!next || next === status) return;
              start(async () => {
                try {
                  await setAgentStatus(
                    id,
                    next as "ENABLED" | "DISABLED" | "SUSPENDED",
                  );
                } catch (e) {
                  alert(e instanceof Error ? e.message : "Erreur");
                }
              });
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ENABLED">ENABLED</SelectItem>
              <SelectItem value="DISABLED">DISABLED</SelectItem>
              <SelectItem value="SUSPENDED">SUSPENDED</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={pending}
            title="Régénérer le token Matrix (réinitialise aussi le cross-signing)"
            onClick={() => {
              if (!confirm("Régénérer le token d'accès Matrix de cet agent ?"))
                return;
              start(async () => {
                try {
                  await rotateAgentToken(id);
                } catch (e) {
                  alert(e instanceof Error ? e.message : "Erreur");
                }
              });
            }}
          >
            <ArrowPathIcon className="size-4" />
          </Button>
          {xsState === "partial" && (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={pending}
              title="Signer le device courant avec la SSK (à faire APRÈS que le bot ait démarré)"
              onClick={() => {
                start(async () => {
                  try {
                    await signAgentDeviceAction(id);
                  } catch (e) {
                    alert(e instanceof Error ? e.message : "Erreur");
                  }
                });
              }}
            >
              <ShieldCheckIcon className="size-4" />
            </Button>
          )}
          <Link
            href={`/agents/${id}/edit`}
            className={buttonVariants({ variant: "outline", size: "icon-sm" })}
            title="Modifier"
          >
            <PencilSquareIcon className="size-4" />
          </Link>
        </>
      )}
      {canDelete && <AgentDeleteDialog agentId={id} slug={slug} name={name} />}
    </div>
  );
}
