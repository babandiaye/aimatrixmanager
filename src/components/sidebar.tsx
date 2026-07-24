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
  QuestionMarkCircleIcon,
  SignalIcon,
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
  // Status : santé des services + modèles Ollama + alertes agents.
  { href: "/status", label: "Status", icon: SignalIcon },
  {
    href: "/settings",
    label: "Paramètres",
    icon: Cog6ToothIcon,
    requiresAny: ["settings.manage"],
  },
  // Aide & contact DITSI
  { href: "/help", label: "Aide", icon: QuestionMarkCircleIcon },
];

export function Sidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const items = NAV.filter(
    (item) => !item.requiresAny || canAny(role, ...item.requiresAny),
  );

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar lg:sticky lg:top-0">
      {/* Logo — accueil */}
      <Link
        href="/"
        className="flex h-24 items-center justify-center border-b border-sidebar-border px-4 transition-colors hover:bg-muted/30"
        title="Accueil AI Bot Manager"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-aibotmanager.png"
          alt="AI Bot Manager"
          className="h-20 w-auto"
        />
      </Link>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
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
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon
                className={cn(
                  "size-5 shrink-0",
                  active
                    ? "text-primary-foreground"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Carte "Assistant IA" en pied de sidebar */}
      <div className="p-3">
        <SidebarAssistantCard />
      </div>
    </aside>
  );
}

/**
 * Petite carte décorative en pied de sidebar : mini illustration robot +
 * CTA vers la gestion des agents. Vise à donner du sens à l'onglet
 * "Agents" pour les utilisateurs qui découvrent l'app.
 */
function SidebarAssistantCard() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 to-primary/5 p-4 text-center">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
        Votre assistant IA
      </div>
      <div className="mx-auto mb-2 flex size-16 items-center justify-center">
        <RobotAvatar />
      </div>
      <p className="mb-3 text-xs leading-snug text-muted-foreground">
        Prêt à connecter vos cours aux salons Matrix.
      </p>
      <Link
        href="/agents"
        className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-transform hover:scale-[1.02]"
      >
        Voir les agents
      </Link>
    </div>
  );
}

/**
 * Petit robot SVG mignon pour la card assistant. Cousin visuel du logo
 * principal — casque bleu, yeux ronds, sourire léger, antenne. Statique,
 * pas d'animation pour rester sobre en pied de sidebar.
 */
function RobotAvatar() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden>
      {/* Antenne */}
      <line
        x1="32"
        y1="8"
        x2="32"
        y2="2"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary"
      />
      <circle cx="32" cy="2" r="2" fill="currentColor" className="text-primary" />
      {/* Tête */}
      <rect
        x="12"
        y="10"
        width="40"
        height="32"
        rx="10"
        className="fill-primary/15"
      />
      <rect
        x="12"
        y="10"
        width="40"
        height="32"
        rx="10"
        className="fill-none stroke-primary"
        strokeWidth="1.5"
      />
      {/* Panneau visage */}
      <rect
        x="18"
        y="18"
        width="28"
        height="18"
        rx="4"
        className="fill-slate-900/85"
      />
      {/* Yeux — grands cercles blancs */}
      <circle cx="26" cy="27" r="3.5" className="fill-white" />
      <circle cx="38" cy="27" r="3.5" className="fill-white" />
      <circle cx="26" cy="27" r="1.5" className="fill-primary" />
      <circle cx="38" cy="27" r="1.5" className="fill-primary" />
      {/* Sourire */}
      <path
        d="M 26 33 Q 32 36 38 33"
        className="fill-none stroke-white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Oreilles/casque */}
      <rect x="8" y="20" width="4" height="10" rx="2" className="fill-primary" />
      <rect x="52" y="20" width="4" height="10" rx="2" className="fill-primary" />
      {/* Corps */}
      <rect
        x="18"
        y="44"
        width="28"
        height="14"
        rx="5"
        className="fill-primary/15 stroke-primary"
        strokeWidth="1.5"
      />
      <circle cx="32" cy="51" r="2" className="fill-primary" />
    </svg>
  );
}
