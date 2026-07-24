import * as React from "react";
import { IconTile } from "./icon-tile";
import { cn } from "@/lib/utils";

/**
 * Header de page authed : IconTile + titre + description, avec un slot
 * optionnel pour actions à droite (bouton "Nouveau", "Refresh", …).
 *
 * Responsive : sur mobile, l'IconTile passe en `lg` (au lieu de xl) pour
 * ne pas prendre trop de place à côté d'un titre qui peut wrapper.
 * Les actions passent en-dessous du titre sur mobile.
 */
export function PageHeader({
  icon,
  title,
  description,
  actions,
  className,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 md:flex-row md:items-start md:justify-between",
        className,
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <IconTile
          icon={icon}
          size="lg"
          variant="primary"
          className="sm:size-16 sm:rounded-2xl"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
