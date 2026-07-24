import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Titre de section avec pastille bleue en préfixe. Réutilisé pour
 * regrouper visuellement des blocs sur les pages "vitrine" (dashboard,
 * mes-cours, /status, /moodle).
 *
 * `tone="muted"` : la pastille passe en gris — utilisé pour marquer une
 * section "secondaire" (ex. cours sans activité Matrix).
 */
export function SectionHeader({
  title,
  description,
  tone = "primary",
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  tone?: "primary" | "muted";
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full",
            tone === "primary" ? "bg-primary" : "bg-muted-foreground/60",
          )}
        />
        <h2
          className={cn(
            "text-lg font-semibold",
            tone === "primary" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {title}
        </h2>
      </div>
      {description && (
        <p className="pl-4 text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
