import Link from "next/link";
import { Footer } from "@/components/footer";
import {
  AcademicCapIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  BookOpenIcon,
  BuildingOfficeIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  EnvelopeIcon,
  KeyIcon,
  PhoneIcon,
  QuestionMarkCircleIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  SignalIcon,
  SparklesIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

/**
 * Page d'aide.
 *
 * Publique (hors groupe `(authed)`) — atteignable :
 *  - depuis /access-denied, par un utilisateur non habilité
 *  - depuis la sidebar et le pied de page, par un utilisateur connecté
 *
 * Le lien de retour pointe sur /dashboard. Chemin relatif volontairement :
 * il suit le domaine sur lequel l'application est servie, sans avoir à être
 * réécrit si celui-ci change.
 */
export default function HelpPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Retour au tableau de bord
        </Link>

        <h1 className="mb-2 text-3xl font-semibold text-foreground">
          Aide &amp; contact
        </h1>
        <p className="mb-8 text-muted-foreground">
          AI Bot Manager permet de créer des assistants IA, de les faire
          entrer dans les salons de discussion de vos cours, et de les
          alimenter avec vos supports pédagogiques. Cette page décrit chaque
          écran, ce que permet chaque rôle, et les parcours les plus
          courants.
        </p>

        {/* ── Principe ─────────────────────────────────────────────── */}
        <section className="mb-10 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold text-foreground">
            <SparklesIcon className="size-5" />
            En trois phrases
          </h2>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">1.</strong> Un{" "}
              <strong className="text-foreground">agent</strong> est un
              assistant IA doté de son propre compte de messagerie et de ses
              propres consignes.
            </li>
            <li>
              <strong className="text-foreground">2.</strong> Vous
              l&apos;affectez à un ou plusieurs{" "}
              <strong className="text-foreground">salons</strong> — le plus
              souvent celui d&apos;un cours Moodle.
            </li>
            <li>
              <strong className="text-foreground">3.</strong> Les étudiants
              l&apos;interpellent dans la conversation ; il répond, et peut
              s&apos;appuyer sur les{" "}
              <strong className="text-foreground">documents du cours</strong>{" "}
              si vous activez l&apos;indexation.
            </li>
          </ol>
        </section>

        {/* ── Fonctionnalités ──────────────────────────────────────── */}
        <h2 className="mb-1 flex items-center gap-2 text-xl font-semibold text-foreground">
          <RocketLaunchIcon className="size-5" />
          Les fonctionnalités, écran par écran
        </h2>
        <p className="mb-5 text-sm text-muted-foreground">
          Tous les écrans ne sont pas visibles par tout le monde : le menu de
          gauche n&apos;affiche que ce que votre rôle autorise.
        </p>

        <div className="mb-10 space-y-3">
          <Feature icon={<ChartBarIcon className="size-5" />} title="Tableau de bord">
            Vue d&apos;ensemble : nombre d&apos;agents actifs, salons
            couverts, activité récente. C&apos;est le point d&apos;entrée
            après connexion.
          </Feature>

          <Feature icon={<BookOpenIcon className="size-5" />} title="Mes cours">
            <p>
              La liste de vos cours Moodle, retrouvés automatiquement à
              partir de <strong>l&apos;adresse email</strong> de votre compte.
              Deux sections :
            </p>
            <ul className="ml-4 mt-2 list-disc space-y-1">
              <li>
                les cours <strong>disposant d&apos;une activité Matrix</strong>,
                sur lesquels vous pouvez agir immédiatement ;
              </li>
              <li>
                les cours <strong>sans activité Matrix</strong>, grisés — il
                faut d&apos;abord en créer une côté Moodle.
              </li>
            </ul>
            <p className="mt-2">
              Le bouton <strong>Rafraîchir depuis Moodle</strong> relance
              toute la chaîne : vos cours, les nouveaux salons, et le lien
              entre les deux. À utiliser après avoir créé une activité côté
              Moodle ou après avoir été ajouté à un cours — la résolution est
              sinon mise en cache une heure.
            </p>
          </Feature>

          <Feature icon={<CpuChipIcon className="size-5" />} title="Agents IA">
            <p>
              Créer, modifier et supprimer vos assistants. À la création,
              l&apos;application provisionne automatiquement un compte de
              messagerie dédié à l&apos;agent — vous n&apos;avez rien à faire
              de ce côté.
            </p>
            <dl className="mt-3 space-y-2">
              <Def term="Identifiant">
                Le nom court par lequel les étudiants l&apos;appellent dans
                une conversation, par exemple <code>@kocc-barma</code>.
              </Def>
              <Def term="Consignes">
                Le texte qui définit son comportement, son ton et son
                périmètre. C&apos;est le réglage qui change le plus la
                qualité des réponses.
              </Def>
              <Def term="Statut">
                Un agent est créé <strong>désactivé</strong>. Il ne répond
                qu&apos;une fois activé — cela vous laisse le temps de le
                configurer et de l&apos;affecter.
              </Def>
              <Def term="Longueur et température">
                La taille maximale d&apos;une réponse, et le degré de
                liberté : 0 pour des réponses stables et factuelles, 1 pour
                des formulations plus variées.
              </Def>
            </dl>
            <p className="mt-3">
              Toute modification est prise en compte{" "}
              <strong>sans redémarrage</strong>, en moins d&apos;une minute.
            </p>
          </Feature>

          <Feature icon={<KeyIcon className="size-5" />} title="Mes fournisseurs IA">
            <p>
              Par défaut, vos agents utilisent le moteur hébergé à
              l&apos;UN-CHK : aucune donnée ne quitte l&apos;établissement et
              rien ne vous est facturé.
            </p>
            <p className="mt-2">
              Cet écran vous permet, si vous le souhaitez, de déclarer{" "}
              <strong>votre propre clé</strong> Anthropic ou OpenAI pour
              obtenir des modèles plus puissants. Trois points à retenir :
            </p>
            <ul className="ml-4 mt-2 list-disc space-y-1">
              <li>
                la clé est <strong>vérifiée avant enregistrement</strong> —
                le bouton « Ajouter » reste inactif tant que la connexion
                n&apos;a pas été testée ;
              </li>
              <li>
                elle est chiffrée et <strong>n&apos;est jamais réaffichée</strong>,
                y compris à un administrateur ;
              </li>
              <li>
                elle est consommée à <strong>chaque message</strong> de
                chaque étudiant dans les salons de vos agents — la
                facturation vous incombe directement.
              </li>
            </ul>
            <p className="mt-2">
              Le fournisseur choisi ici devient votre défaut ; vous pouvez
              en désigner un autre agent par agent.
            </p>
          </Feature>

          <Feature icon={<ChatBubbleLeftRightIcon className="size-5" />} title="Salons">
            <p>
              Les conversations découvertes sur le serveur de messagerie.
              C&apos;est ici que vous <strong>affectez un agent</strong> à un
              salon, et que vous liez ce salon à son cours Moodle.
            </p>
            <p className="mt-2">
              Vous y activez aussi{" "}
              <strong>l&apos;indexation des documents</strong> : une fois
              lancée, l&apos;agent peut citer le contenu réel du cours plutôt
              que de répondre de mémoire. Le traitement se fait en arrière-plan
              et sa progression est affichée.
            </p>
            <p className="mt-2 rounded-md border border-border bg-background p-3 text-xs">
              <strong className="text-foreground">Bon à savoir —</strong> dans
              un salon à trois participants ou plus, l&apos;agent ne répond
              qu&apos;à une <strong>mention explicite</strong>. Dans une
              conversation à deux, il répond à tous les messages.
            </p>
          </Feature>

          <Feature icon={<AcademicCapIcon className="size-5" />} title="Plateformes Moodle">
            <p>
              Le référentiel des instances Moodle reliées à
              l&apos;application. Chaque plateforme apporte ses cours et ses
              activités Matrix.
            </p>
            <p className="mt-2">
              Un enseignant y accède en lecture et peut lancer une{" "}
              <strong>synchronisation</strong> pour faire remonter ses
              nouveaux cours, sans dépendre d&apos;un administrateur. La
              création et la modification d&apos;une plateforme restent
              réservées à l&apos;administration : elles manipulent un jeton
              d&apos;accès sensible.
            </p>
          </Feature>

          <Feature icon={<UserGroupIcon className="size-5" />} title="Utilisateurs">
            Réservé à l&apos;administration : la liste des comptes et leur
            rôle. C&apos;est ici qu&apos;on promeut ou rétrograde quelqu&apos;un.
          </Feature>

          <Feature icon={<SignalIcon className="size-5" />} title="État des services">
            Le point de santé en temps réel de tout ce dont dépend
            l&apos;application : base de données, serveur de messagerie,
            moteur IA, plateformes Moodle, et présence des agents. À
            consulter en premier quand quelque chose ne répond pas.
          </Feature>

          <Feature icon={<Cog6ToothIcon className="size-5" />} title="Paramètres">
            Réglages généraux de l&apos;application, réservés à
            l&apos;administration.
          </Feature>
        </div>

        {/* ── Rôles ────────────────────────────────────────────────── */}
        <h2 className="mb-1 flex items-center gap-2 text-xl font-semibold text-foreground">
          <ShieldCheckIcon className="size-5" />
          Ce que permet chaque rôle
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Un nouveau compte reçoit le rôle <strong>Enseignant</strong>. Seul
          un administrateur peut le changer.
        </p>
        <div className="mb-10 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-card">
              <tr className="text-left">
                <th className="px-4 py-2.5 font-medium text-foreground">Action</th>
                <th className="px-3 py-2.5 text-center font-medium text-foreground">Admin</th>
                <th className="px-3 py-2.5 text-center font-medium text-foreground">Manager</th>
                <th className="px-3 py-2.5 text-center font-medium text-foreground">Enseignant</th>
                <th className="px-3 py-2.5 text-center font-medium text-foreground">Auditeur</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              <Row label="Créer un agent" a="oui" m="oui" e="oui" x="—" />
              <Row label="Modifier ses propres agents" a="oui" m="oui" e="oui" x="—" />
              <Row label="Modifier tous les agents" a="oui" m="oui" e="—" x="—" />
              <Row label="Déclarer sa propre clé IA" a="oui" m="oui" e="oui" x="—" />
              <Row label="Affecter un agent à un salon" a="oui" m="oui" e="ses salons" x="—" />
              <Row label="Voir tous les salons" a="oui" m="oui" e="ses cours" x="oui" />
              <Row label="Indexer les documents d'un cours" a="oui" m="oui" e="—" x="—" />
              <Row label="Voir les plateformes Moodle" a="oui" m="oui" e="lecture" x="lecture" />
              <Row label="Créer une plateforme Moodle" a="oui" m="—" e="—" x="—" />
              <Row label="Gérer les utilisateurs" a="oui" m="—" e="—" x="—" />
              <Row label="Consulter les conversations" a="oui" m="oui" e="—" x="oui" />
            </tbody>
          </table>
        </div>

        {/* ── Parcours ─────────────────────────────────────────────── */}
        <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-foreground">
          <ArrowPathIcon className="size-5" />
          Deux parcours types
        </h2>
        <div className="mb-10 grid gap-4 sm:grid-cols-2">
          <Path title="Enseignant — premier agent">
            <li>Ouvrir <strong>Mes cours</strong> et vérifier que le cours apparaît</li>
            <li><strong>Agents IA</strong> → créer l&apos;agent et rédiger ses consignes</li>
            <li>Passer son statut à <strong>actif</strong></li>
            <li><strong>Salons</strong> → l&apos;affecter au salon du cours</li>
            <li>L&apos;interpeller dans la conversation pour vérifier</li>
          </Path>
          <Path title="Administrateur — mise en service">
            <li><strong>Plateformes Moodle</strong> → déclarer l&apos;instance</li>
            <li>Synchroniser les cours, puis les activités Matrix</li>
            <li><strong>Salons</strong> → lancer la découverte</li>
            <li><strong>Utilisateurs</strong> → attribuer les rôles</li>
            <li><strong>État des services</strong> → tout vérifier au vert</li>
          </Path>
        </div>

        {/* ── Contact ──────────────────────────────────────────────── */}
        <section className="mb-10 rounded-xl border border-border bg-card p-6">
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

        {/* ── FAQ ──────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <QuestionMarkCircleIcon className="size-5" />
            Questions fréquentes
          </h2>

          <FaqItem
            icon={<KeyIcon className="size-4 text-primary" />}
            question="Je suis redirigé vers « Accès non autorisé »"
          >
            AI Bot Manager est réservé au <strong>personnel UN-CHK</strong>{" "}
            (enseignants, administratifs, doctorants encadrants…). Les
            comptes étudiants et tuteurs ne sont pas habilités. Si vous
            pensez qu&apos;il s&apos;agit d&apos;une erreur
            d&apos;affiliation, écrivez à{" "}
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
            question="« Mes cours » est vide alors que j'enseigne sur Moodle"
          >
            Le rapprochement se fait par <strong>adresse email exacte</strong> :
            celle de votre compte de connexion doit être identique à celle de
            votre compte Moodle. Vérifiez aussi que vous êtes bien enseignant
            ou tuteur dans au moins un cours. Le résultat étant mis en cache
            une heure, utilisez <strong>Rafraîchir depuis Moodle</strong> si
            vous venez d&apos;être ajouté.
          </FaqItem>

          <FaqItem
            icon={<ChatBubbleLeftRightIcon className="size-4 text-primary" />}
            question="Mon agent ne répond pas dans un salon"
          >
            Trois vérifications, dans cet ordre :
            <ul className="ml-4 mt-2 list-disc space-y-1">
              <li>l&apos;agent est-il bien <strong>actif</strong> ?</li>
              <li>
                l&apos;affectation au salon est-elle <strong>activée</strong> ?
              </li>
              <li>
                dans un salon à trois participants ou plus, il faut le{" "}
                <strong>mentionner explicitement</strong> — il ignore les
                messages qui ne le nomment pas.
              </li>
            </ul>
          </FaqItem>

          <FaqItem
            icon={<SparklesIcon className="size-4 text-primary" />}
            question="L'agent répond « le modèle est en train de démarrer »"
          >
            Le moteur hébergé à l&apos;UN-CHK charge le modèle en mémoire à
            la première sollicitation, ce qui peut demander une minute.
            Reposez simplement la question : les réponses suivantes sont
            quasi immédiates. Si le message revient systématiquement,
            signalez-le à la DITSI.
          </FaqItem>

          <FaqItem
            icon={<CpuChipIcon className="size-4 text-primary" />}
            question="L'agent invente des réponses au lieu de citer mon cours"
          >
            C&apos;est le comportement normal tant que{" "}
            <strong>l&apos;indexation des documents</strong> n&apos;a pas été
            activée pour ce salon. Sans elle, l&apos;agent ne connaît que ses
            consignes générales. Activez-la depuis la fiche du salon, puis
            attendez la fin du traitement.
          </FaqItem>

          <FaqItem
            icon={<ShieldCheckIcon className="size-4 text-primary" />}
            question="Mon agent a été expulsé d'un salon"
          >
            Il retente automatiquement d&apos;y entrer, avec un délai de cinq
            minutes entre deux essais. Après trois échecs, l&apos;affectation
            est désactivée : le système considère que la présence de
            l&apos;agent n&apos;est pas souhaitée. Vous pouvez la réactiver
            depuis la fiche du salon une fois la situation clarifiée.
          </FaqItem>
        </section>
      </div>
      <Footer />
    </div>
  );
}

/* ── Blocs réutilisés ────────────────────────────────────────────── */

function Feature({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-border bg-card p-5 open:bg-card/80">
      <summary className="flex cursor-pointer items-center gap-3 font-medium text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </summary>
      <div className="mt-3 space-y-2 text-sm text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

function Def({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-foreground">
        {term}
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Row({
  label,
  a,
  m,
  e,
  x,
}: {
  label: string;
  a: string;
  m: string;
  e: string;
  x: string;
}) {
  const cell = (v: string) => (
    <td className="px-3 py-2 text-center">
      {v === "oui" ? (
        <span className="text-status-ok">oui</span>
      ) : v === "—" ? (
        <span className="text-muted-foreground/50">—</span>
      ) : (
        <span className="text-xs">{v}</span>
      )}
    </td>
  );
  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2 text-foreground">{label}</td>
      {cell(a)}
      {cell(m)}
      {cell(e)}
      {cell(x)}
    </tr>
  );
}

function Path({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <ol className="ml-4 list-decimal space-y-1.5 text-sm text-muted-foreground">
        {children}
      </ol>
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
