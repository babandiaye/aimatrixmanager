"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { canAny, type Permission } from "@/lib/permissions";
import type { UserRole } from "@prisma/client";
import {
  ChartBarIcon,
  CpuChipIcon,
  ChatBubbleLeftRightIcon,
  AcademicCapIcon,
  BookOpenIcon,
  UserGroupIcon,
  Cog6ToothIcon,
} from "@heroicons/react/24/outline";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  /** Liste de permissions ; au moins une suffit. Si vide, item toujours visible. */
  requiresAny?: Permission[];
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Tableau de bord", icon: ChartBarIcon },
  {
    href: "/mes-cours",
    label: "Mes cours",
    icon: BookOpenIcon,
    requiresAny: ["rooms.view", "rooms.view-own"],
  },
  {
    href: "/agents",
    label: "Agents",
    icon: CpuChipIcon,
    requiresAny: ["agents.view", "agents.view-own"],
  },
  {
    href: "/rooms",
    label: "Salons",
    icon: ChatBubbleLeftRightIcon,
    requiresAny: ["rooms.view", "rooms.view-own"],
  },
  {
    href: "/moodle",
    label: "Plateformes Moodle",
    icon: AcademicCapIcon,
    requiresAny: ["moodle.view"],
  },
  {
    href: "/users",
    label: "Utilisateurs",
    icon: UserGroupIcon,
    requiresAny: ["users.manage"],
  },
  {
    href: "/settings",
    label: "Paramètres",
    icon: Cog6ToothIcon,
    requiresAny: ["settings.manage"],
  },
];

export function Sidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const items = NAV.filter(
    (item) => !item.requiresAny || canAny(role, ...item.requiresAny),
  );

  return (
    <aside className="w-52 shrink-0 border-r border-sidebar-border bg-sidebar">
      <Link
        href="/"
        className="flex h-16 flex-col items-start justify-center gap-0.5 border-b border-sidebar-border px-4 transition-colors hover:bg-muted/30"
        title="Accueil AI Bot Manager"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-unchk.png"
          alt="UN-CHK"
          className="h-8 w-auto"
        />
        <span className="text-[10px] font-medium tracking-wider text-muted-foreground">
          AI Bot Manager
        </span>
      </Link>
      <nav className="p-2">
        {items.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-active text-primary border-r-2 border-sidebar-active-border font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
