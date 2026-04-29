import Link from "next/link";
import { auth } from "@/auth";
import { Footer } from "@/components/footer";
import { buttonVariants } from "@/components/ui/button";
import {
  AcademicCapIcon,
  LockClosedIcon,
  ChatBubbleLeftRightIcon,
  UsersIcon,
  BookOpenIcon,
  SparklesIcon,
  GlobeAltIcon,
} from "@heroicons/react/24/outline";

type FeatureColor = "blue" | "green" | "orange" | "institutional";

type Feature = {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  color: FeatureColor;
};

const FEATURES: Feature[] = [
  {
    icon: BookOpenIcon,
    title: "Apprentissage augmenté",
    description:
      "Chaque cours en ligne dispose d'un assistant IA qui répond aux questions des étudiants en temps réel, dans le salon Matrix du cours.",
    color: "blue",
  },
  {
    icon: SparklesIcon,
    title: "Multi-fournisseurs LLM",
    description:
      "Anthropic Claude pour la qualité (US) ou Ollama souverain (UN-CHK) pour la confidentialité — au choix par agent.",
    color: "orange",
  },
  {
    icon: AcademicCapIcon,
    title: "Connecté à Moodle",
    description:
      "Lie chaque salon à un cours Moodle. L'agent accède aux ressources pédagogiques via les Web Services pour des réponses contextualisées.",
    color: "green",
  },
  {
    icon: ChatBubbleLeftRightIcon,
    title: "Intégration Matrix native",
    description:
      "Les agents rejoignent automatiquement les salons des activités Moodle et répondent par mention — comme un membre humain.",
    color: "blue",
  },
  {
    icon: LockClosedIcon,
    title: "E2EE & souveraineté",
    description:
      "Chiffrement bout-en-bout, secrets chiffrés AES-256-GCM en base, modèles IA hébergés en interne UN-CHK.",
    color: "institutional",
  },
  {
    icon: UsersIcon,
    title: "Rôles granulaires",
    description:
      "Admin, Manager, Auditor : permissions précises pour gérer agents, salons et plateformes Moodle. Single sign-on Keycloak.",
    color: "orange",
  },
];

// Mapping classes Tailwind par couleur — explicite pour que Tailwind les compile.
// Charte BBB-style : bordure et titre déjà colorés au repos, et au survol le
// bloc se remplit d'une teinte pastel marquée. L'icône reste douce, on ne la
// remplit pas en saturé (l'œil va vers le bloc, pas vers l'icône).
const colorClasses: Record<
  FeatureColor,
  {
    border: string;
    iconBg: string;
    iconText: string;
    titleText: string;
    hoverBg: string;
    hoverBorder: string;
  }
> = {
  blue: {
    border: "border-primary/30",
    iconBg: "bg-blue-50",
    iconText: "text-primary",
    titleText: "text-primary",
    hoverBg: "hover:bg-blue-100",
    hoverBorder: "hover:border-primary/70",
  },
  green: {
    border: "border-status-published/30",
    iconBg: "bg-green-50",
    iconText: "text-status-published",
    titleText: "text-status-published",
    hoverBg: "hover:bg-green-100",
    hoverBorder: "hover:border-status-published/70",
  },
  orange: {
    border: "border-status-processed/30",
    iconBg: "bg-orange-50",
    iconText: "text-status-processed",
    titleText: "text-status-processed",
    hoverBg: "hover:bg-orange-100",
    hoverBorder: "hover:border-status-processed/70",
  },
  institutional: {
    border: "border-institutional/30",
    iconBg: "bg-blue-50",
    iconText: "text-institutional",
    titleText: "text-institutional",
    hoverBg: "hover:bg-blue-100",
    hoverBorder: "hover:border-institutional/70",
  },
};

export default async function LandingPage() {
  const session = await auth();
  const isAuth = Boolean(session?.user);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ── Navbar ───────────────────────────────────────────────────── */}
      <nav className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-unchk.png"
              alt="UN-CHK"
              className="h-9 w-auto"
            />
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={isAuth ? "/dashboard" : "/login"}
              className={buttonVariants({ size: "default" })}
            >
              {isAuth ? "Tableau de bord" : "Connexion"}
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-secondary/40 to-background">
        <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-foreground md:text-5xl lg:text-6xl">
              Des assistants IA{" "}
              <span className="text-primary">au service de tes cours</span> en
              ligne.
            </h1>
            <p className="mt-6 text-lg text-muted-foreground md:text-xl">
              Chaque cours Moodle dispose d&apos;un agent IA dans son salon
              Matrix. Les étudiants posent leurs questions, l&apos;agent
              répond avec le contexte du cours.{" "}
              <span className="font-medium text-foreground">
                Anthropic Claude
              </span>{" "}
              ou{" "}
              <span className="font-medium text-status-processed">
                Ollama souverain
              </span>{" "}
              au choix.
            </p>
          </div>
        </div>
      </section>

      {/* ── Pour les cours en ligne ──────────────────────────────────── */}
      <section className="border-b border-border bg-card">
        <div className="mx-auto max-w-7xl px-6 py-16 md:py-20">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-status-published/20 bg-status-published/5 px-3 py-1 text-xs font-medium text-status-published">
                <BookOpenIcon className="size-3.5" />
                Pensé pour les cours en ligne
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                Un tuteur IA par cours, disponible 24/7
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Quand un enseignant crée un cours sur Moodle avec le plugin{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  mod_matrix
                </code>
                , un salon Matrix est provisionné automatiquement.
                aibotmanager y déploie un agent IA dédié qui :
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  {
                    color: "text-primary",
                    text: "Répond aux questions des étudiants en mention",
                  },
                  {
                    color: "text-status-published",
                    text: "Comprend le contexte du cours (Moodle Web Services)",
                  },
                  {
                    color: "text-status-processed",
                    text: "Trace les conversations pour le suivi pédagogique",
                  },
                  {
                    color: "text-institutional",
                    text: "Fonctionne aussi en privé (DM) pour des questions sensibles",
                  },
                ].map((item) => (
                  <li key={item.text} className="flex items-start gap-3">
                    <div className={`mt-1 size-2 shrink-0 rounded-full ${item.color.replace("text-", "bg-")}`} />
                    <span className="text-sm text-foreground">{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-border bg-secondary/30 p-6 font-mono text-sm">
              <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <ChatBubbleLeftRightIcon className="size-4" />
                Salon Matrix · Cours « Algorithmique L1 »
              </div>
              <div className="space-y-3">
                <div className="rounded-lg bg-card p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Étudiant
                  </div>
                  <div className="mt-1 text-foreground">
                    @kocc-barma c&apos;est quoi la complexité d&apos;un tri à
                    bulle ?
                  </div>
                </div>
                <div className="rounded-lg border border-primary/20 bg-blue-50 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-primary">
                    Agent IA
                  </div>
                  <div className="mt-1 text-foreground">
                    Le tri à bulle a une complexité <strong>O(n²)</strong>{" "}
                    dans le pire cas — il compare des paires adjacentes et
                    parcourt le tableau autant de fois qu&apos;il y a
                    d&apos;éléments. Tu veux que je te montre l&apos;algo en
                    Python ?
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section id="features" className="bg-background">
        <div className="mx-auto max-w-7xl px-6 py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Une plateforme complète
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Toutes les briques nécessaires pour piloter des agents IA
              pédagogiques en toute sécurité.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => {
              const c = colorClasses[f.color];
              return (
                <div
                  key={f.title}
                  className={`rounded-xl border ${c.border} bg-card p-6 transition-colors ${c.hoverBg} ${c.hoverBorder}`}
                >
                  <div
                    className={`inline-flex size-10 items-center justify-center rounded-lg ${c.iconBg} ${c.iconText}`}
                  >
                    <f.icon className="size-5" />
                  </div>
                  <h3
                    className={`mt-4 text-base font-semibold ${c.titleText}`}
                  >
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {f.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-16 md:py-24">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Comment ça marche
          </h2>
          <ol className="mt-12 grid gap-6 md:grid-cols-4">
            {[
              {
                n: "1",
                t: "Crée un agent",
                d: "Slug Matrix, prompt système, choix du modèle (Claude ou Ollama).",
                color: "text-primary",
              },
              {
                n: "2",
                t: "Provisioning auto",
                d: "Compte Matrix créé via Synapse Admin API. Token chiffré.",
                color: "text-status-published",
              },
              {
                n: "3",
                t: "Affecte aux salons",
                d: "Agent rejoint les salons des cours Moodle. Mentionnable par les étudiants.",
                color: "text-status-processed",
              },
              {
                n: "4",
                t: "Pilote",
                d: "Suivi temps-réel des agents en ligne et de la santé des services.",
                color: "text-institutional",
              },
            ].map((s) => (
              <li
                key={s.n}
                className="rounded-xl border border-border bg-card p-6"
              >
                <div className={`text-3xl font-bold ${s.color}`}>{s.n}</div>
                <div className="mt-2 font-semibold text-foreground">
                  {s.t}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {s.d}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Souveraineté ──────────────────────────────────────────────── */}
      <section className="border-t border-border bg-card">
        <div className="mx-auto max-w-7xl px-6 py-16 md:py-20 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-status-processed/20 bg-orange-50 px-3 py-1 text-xs font-medium text-status-processed">
            <GlobeAltIcon className="size-3.5" />
            Hébergement souverain
          </div>
          <h2 className="mx-auto mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Tes conversations restent à l&apos;UN-CHK
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Avec l&apos;option <strong className="text-status-processed">Ollama</strong>,
            les modèles tournent sur l&apos;infrastructure UN-CHK. Aucune
            donnée pédagogique ne sort du réseau interne.
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
