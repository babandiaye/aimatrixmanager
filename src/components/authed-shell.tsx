"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/topbar";
import { Footer } from "@/components/footer";
import type { UserRole } from "@prisma/client";
import { cn } from "@/lib/utils";

/**
 * Wrapper client de la zone authed : gère l'ouverture de la sidebar sur
 * mobile via un state local. Sur écrans lg+ (≥1024px), la sidebar est
 * toujours visible en flux normal — le state est ignoré côté rendu.
 *
 * Ferme automatiquement la sidebar à chaque changement de route pour
 * éviter qu'elle reste ouverte après un clic de nav.
 */
export function AuthedShell({
  role,
  user,
  children,
}: {
  role: UserRole;
  user: { name?: string | null; email: string; role: string };
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Referme la sidebar à chaque nav (clic sur un item, back/forward, …).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Empêche le scroll body quand le drawer mobile est ouvert.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Overlay noir semi-transparent derrière le drawer mobile. */}
      {open && (
        <button
          type="button"
          aria-label="Fermer le menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Sidebar — statique en lg+, drawer en mobile. */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 transition-transform duration-200 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <Sidebar role={role} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} onOpenSidebar={() => setOpen(true)} />
        <main className="relative min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6">
          {children}
        </main>
        <Footer />
      </div>
    </div>
  );
}
