import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Petit carré arrondi coloré avec icône dedans. Réutilisé comme préfixe
 * de titres, dans les cards KPI, ou pour tagger un cours/plateforme.
 *
 * Variants :
 *  - primary  : fond bleu clair, icône bleue (défaut, non-actif)
 *  - accent   : fond bleu marine, icône blanche (highlight, KPI mis en avant)
 *  - muted    : fond gris clair, icône gris foncé (état neutre / grisé)
 *  - success  : fond vert pâle, icône verte (checks, OK)
 *  - warning  : fond orange pâle, icône orange (alerte non bloquante)
 *
 * Sizes : sm (24px), md (36px, défaut), lg (48px), xl (64px)
 */
type Variant = "primary" | "accent" | "muted" | "success" | "warning";
type Size = "sm" | "md" | "lg" | "xl";

const variantClasses: Record<Variant, string> = {
  primary: "bg-primary/10 text-primary",
  accent: "bg-primary text-primary-foreground",
  muted: "bg-muted text-muted-foreground",
  success: "bg-status-published/10 text-status-published",
  warning: "bg-status-unpublished/10 text-status-unpublished",
};

const sizeClasses: Record<Size, string> = {
  sm: "size-6 rounded-md [&>svg]:size-3.5",
  md: "size-9 rounded-lg [&>svg]:size-4",
  lg: "size-12 rounded-xl [&>svg]:size-6",
  xl: "size-16 rounded-2xl [&>svg]:size-8",
};

export function IconTile({
  icon: Icon,
  variant = "primary",
  size = "md",
  className,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  variant?: Variant;
  size?: Size;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      <Icon />
    </span>
  );
}
