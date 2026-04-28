"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export function AuditFilters({
  agents,
  currentAgent,
  currentPeriod,
}: {
  agents: { id: string; slug: string; name: string }[];
  currentAgent: string | null;
  currentPeriod: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === "all") next.delete(key);
    else next.set(key, value);
    next.delete("page"); // reset pagination
    const qs = next.toString();
    router.push(qs ? `/audit?${qs}` : "/audit");
  };

  return (
    <div className="grid gap-3 md:grid-cols-2 max-w-2xl">
      <div className="space-y-1">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Agent
        </Label>
        <Select
          value={currentAgent ?? "all"}
          onValueChange={(v) => v && update("agent", v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les agents</SelectItem>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                @{a.slug} — {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Période
        </Label>
        <Select
          value={currentPeriod}
          onValueChange={(v) => v && update("period", v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">24 heures</SelectItem>
            <SelectItem value="7d">7 jours</SelectItem>
            <SelectItem value="30d">30 jours</SelectItem>
            <SelectItem value="all">Tout</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
