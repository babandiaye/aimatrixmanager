"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { setKeycloakEnabled } from "./actions";

export function KeycloakToggle({
  enabled,
  disabled,
}: {
  enabled: boolean;
  disabled: boolean;
}) {
  const [optimistic, setOptimistic] = useState(enabled);
  const [pending, start] = useTransition();

  return (
    <Switch
      checked={optimistic}
      disabled={disabled || pending}
      onCheckedChange={(next) => {
        setOptimistic(next);
        start(async () => {
          try {
            await setKeycloakEnabled(next);
          } catch {
            setOptimistic(!next); // rollback
          }
        });
      }}
    />
  );
}
