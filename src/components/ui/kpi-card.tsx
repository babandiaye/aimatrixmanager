import * as React from "react";
import { cn } from "@/lib/utils";
import { IconTile } from "./icon-tile";

/**
 * Grande carte KPI style dashboard : icon tile en haut à gauche, gros
 * chiffre au centre, label discret en dessous. Une "vague" décorative
 * SVG en pied donne la touche visuelle du design UN-CHK.
 *
 * `accent=true` : la card entière passe en bleu marine, texte blanc.
 * Utile pour mettre en avant LA métrique-clé d'un dashboard (ex. « Agents
 * déployés » sur /mes-cours).
 */
export function KpiCard({
  icon,
  value,
  label,
  accent = false,
  className,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  value: number | string;
  label: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border ring-1 ring-foreground/5",
        accent
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card",
        className,
      )}
    >
      <div className="relative z-10 flex flex-col gap-4 p-5">
        <IconTile
          icon={icon}
          size="lg"
          variant={accent ? "muted" : "primary"}
          className={
            accent
              ? "bg-primary-foreground/15 text-primary-foreground"
              : undefined
          }
        />
        <div>
          <div
            className={cn(
              "text-4xl font-bold leading-none tracking-tight",
              accent ? "text-primary-foreground" : "text-foreground",
            )}
          >
            {value}
          </div>
          <div
            className={cn(
              "mt-2 text-xs font-medium uppercase tracking-wider",
              accent
                ? "text-primary-foreground/70"
                : "text-muted-foreground",
            )}
          >
            {label}
          </div>
        </div>
      </div>
      {/* Vague décorative en pied — 2 courbes bleues qui donnent la
          signature visuelle du design. En mode accent on l'atténue
          davantage pour ne pas surcharger. */}
      <svg
        aria-hidden
        viewBox="0 0 400 80"
        preserveAspectRatio="none"
        className={cn(
          "absolute inset-x-0 bottom-0 h-14 w-full",
          accent ? "text-primary-foreground/10" : "text-primary/10",
        )}
      >
        <path
          d="M0,50 Q100,10 200,45 T400,40 L400,80 L0,80 Z"
          fill="currentColor"
        />
        <path
          d="M0,60 Q100,30 200,55 T400,50 L400,80 L0,80 Z"
          fill="currentColor"
          opacity="0.6"
        />
      </svg>
    </div>
  );
}
