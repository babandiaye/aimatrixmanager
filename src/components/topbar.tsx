"use client";

import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import {
  ArrowLeftStartOnRectangleIcon,
  BellIcon,
  Bars3Icon,
} from "@heroicons/react/24/outline";
import { logoutCompletely } from "@/app/(authed)/logout-action";
import { roleLabel } from "@/lib/role-labels";

/**
 * Barre supérieure. Layout :
 *
 *  [☰ mobile only] ................ [nom + rôle] [avatar] [🔔] [Déconnexion]
 *
 * Sur mobile (<lg) :
 *  - Le burger appelle onOpenSidebar → drawer géré par AuthedShell.
 *  - Le bloc "nom + rôle" est masqué pour laisser la place, on garde
 *    l'avatar comme identifiant visuel.
 *  - Le libellé "Déconnexion" se réduit à l'icône seule.
 */
export function TopBar({
  user,
  notificationsCount = 0,
  onOpenSidebar,
}: {
  user: {
    name?: string | null;
    email: string;
    role: string;
  };
  notificationsCount?: number;
  onOpenSidebar?: () => void;
}) {
  const displayName = user.name ?? user.email;
  return (
    <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
      {/* Burger — mobile uniquement */}
      <button
        type="button"
        aria-label="Ouvrir le menu"
        onClick={onOpenSidebar}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
      >
        <Bars3Icon className="size-6" />
      </button>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {/* Bloc identité — nom + rôle traduit. Email retiré (déjà connu de
            l'utilisateur, alourdit la barre). Masqué sur mobile pour ne
            garder que l'avatar comme signal visuel. */}
        <div className="hidden text-right text-sm leading-tight sm:block">
          <div className="font-semibold text-foreground">{displayName}</div>
          <div className="text-xs text-muted-foreground">
            {roleLabel(user.role)}
          </div>
        </div>
        <UserAvatar name={user.name} email={user.email} size="md" />

        {/* Cloche notifications — badge visible seulement s'il y a du contenu. */}
        <button
          type="button"
          aria-label={
            notificationsCount > 0
              ? `${notificationsCount} notification(s)`
              : "Notifications"
          }
          className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <BellIcon className="size-5" />
          {notificationsCount > 0 && (
            <span className="absolute right-1 top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-status-error px-1 text-[10px] font-semibold leading-4 text-white ring-2 ring-card">
              {notificationsCount > 9 ? "9+" : notificationsCount}
            </span>
          )}
        </button>

        <form action={logoutCompletely}>
          <Button type="submit" variant="destructive" size="sm">
            <ArrowLeftStartOnRectangleIcon className="size-4" />
            <span className="hidden sm:inline">Déconnexion</span>
          </Button>
        </form>
      </div>
    </header>
  );
}
