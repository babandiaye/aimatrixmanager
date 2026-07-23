import Link from "next/link";
import { Footer } from "@/components/footer";
import {
  EnvelopeIcon,
  BuildingOfficeIcon,
  PhoneIcon,
  ArrowLeftIcon,
  QuestionMarkCircleIcon,
  KeyIcon,
  AcademicCapIcon,
} from "@heroicons/react/24/outline";

/**
 * Page d'aide / contact DITSI.
 *
 * Publique (pas dans `(authed)`) — accessible :
 *  - depuis le lien "Contact DITSI" dans /access-denied (user rejeté)
 *  - depuis le footer / la sidebar pour les users connectés
 *
 * Contient : coordonnées DITSI, FAQ rapide sur l'accès, premiers pas.
 */
export default function HelpPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Link
          href="/"
          className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Page d&apos;accueil
        </Link>

        <h1 className="mb-2 text-3xl font-semibold text-foreground">
          Aide &amp; contact
        </h1>
        <p className="mb-8 text-muted-foreground">
          AI Bot Manager est développé et maintenu par la{" "}
          <strong>DITSI</strong> de l&apos;UN-CHK. Cette page recense les
          points de contact et les réponses aux questions les plus
          fréquentes.
        </p>

        {/* Contact DITSI */}
        <section className="mb-8 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-foreground">
            <BuildingOfficeIcon className="size-5" />
            Contacter la DITSI
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Direction des Infrastructures, Technologies et Systèmes
            d&apos;Information — Université Numérique Cheikh Hamidou Kane.
          </p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <EnvelopeIcon className="size-3.5" />
                Email
              </dt>
              <dd className="mt-1">
                <a
                  href="mailto:ditsi@unchk.edu.sn"
                  className="font-mono text-primary hover:underline"
                >
                  ditsi@unchk.edu.sn
                </a>
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <PhoneIcon className="size-3.5" />
                Téléphone
              </dt>
              <dd className="mt-1 text-foreground">+221 33 859 70 00</dd>
            </div>
          </dl>
        </section>

        {/* FAQ */}
        <section className="space-y-5">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <QuestionMarkCircleIcon className="size-5" />
            Questions fréquentes
          </h2>

          <FaqItem
            icon={<KeyIcon className="size-4 text-primary" />}
            question="Je suis redirigé vers la page « Accès non autorisé »"
          >
            AI Bot Manager est réservé au <strong>personnel UN-CHK</strong>{" "}
            (enseignants, administratifs, doctorants encadrants…). Les
            comptes étudiants et tuteurs ne sont pas habilités. Si tu penses
            qu&apos;il s&apos;agit d&apos;une erreur d&apos;affiliation dans
            ton compte Keycloak, contacte la DITSI à{" "}
            <a
              href="mailto:ditsi@unchk.edu.sn"
              className="text-primary hover:underline"
            >
              ditsi@unchk.edu.sn
            </a>
            .
          </FaqItem>

          <FaqItem
            icon={<AcademicCapIcon className="size-4 text-primary" />}
            question="Mon onglet « Mes cours » est vide alors que j'enseigne sur Moodle"
          >
            La résolution Moodle se fait par <strong>email exact</strong> :
            l&apos;email de ton compte Keycloak doit correspondre
            précisément à l&apos;email de ton compte Moodle. Vérifie aussi
            que tu as le rôle <code>editingteacher</code> ou{" "}
            <code>teacher</code> dans au moins un cours. La résolution est
            mise en cache 1h — si tu viens d&apos;être ajouté à un cours,
            attends ou contacte la DITSI pour forcer un rafraîchissement.
          </FaqItem>

          <FaqItem
            icon={<QuestionMarkCircleIcon className="size-4 text-primary" />}
            question="Mon agent IA ne répond pas dans un salon"
          >
            Trois vérifications :
            <ul className="ml-4 mt-2 list-disc space-y-1">
              <li>
                L&apos;agent a-t-il bien le statut <code>ENABLED</code> ?
                (page <code>/agents</code>)
              </li>
              <li>
                L&apos;assignation au salon est-elle <code>active</code> ?
                (page <code>/rooms/[id]</code>, switch « actif ici »)
              </li>
              <li>
                Dans un salon groupe (3+ membres), l&apos;agent ne répond
                qu&apos;à une <strong>mention explicite</strong>{" "}
                (<code>@slug …</code>). Dans un DM (conversation directe à
                2), il répond à tout.
              </li>
            </ul>
          </FaqItem>

          <FaqItem
            icon={<QuestionMarkCircleIcon className="size-4 text-primary" />}
            question="Mon agent a été expulsé d'un salon"
          >
            Si l&apos;auto-rejoin est activé (défaut), l&apos;agent retente
            automatiquement le join avec un cooldown de 5 minutes. Au-delà
            de 3 échecs, l&apos;assignation est désactivée pour éviter une
            guerre kick/rejoin avec l&apos;admin du salon. Tu peux
            réactiver manuellement depuis <code>/rooms/[id]</code> ou
            cliquer sur « Rejoindre maintenant » si la situation est
            résolue.
          </FaqItem>
        </section>
      </div>
      <Footer />
    </div>
  );
}

function FaqItem({
  question,
  icon,
  children,
}: {
  question: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-border bg-card p-4 open:bg-card/80">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
        {icon}
        {question}
      </summary>
      <div className="mt-3 text-sm text-muted-foreground">{children}</div>
    </details>
  );
}
