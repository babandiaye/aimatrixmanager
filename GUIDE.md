# Guide d'utilisation — AI Bot Manager

Ce guide s'adresse aux utilisateurs de la plateforme : administrateurs,
gestionnaires et enseignants. Il décrit **ce qu'on fait dans l'interface**,
dans quel ordre, et surtout **quand relancer quoi**.

> 📘 Pour l'installation serveur, voir [`DEPLOYMENT.md`](DEPLOYMENT.md).
> Pour l'architecture technique, voir [`README.md`](README.md).

---

## Sommaire

- [Comprendre le modèle](#comprendre-le-modèle)
- [Rôles et ce que chacun peut faire](#rôles-et-ce-que-chacun-peut-faire)
- [Étape 1 — Ajouter une plateforme Moodle](#étape-1--ajouter-une-plateforme-moodle)
- [Étape 2 — Synchroniser les cours](#étape-2--synchroniser-les-cours)
- [Étape 3 — Récupérer les activités Matrix](#étape-3--récupérer-les-activités-matrix)
- [Étape 4 — Importer les salons](#étape-4--importer-les-salons)
- [Étape 5 — Créer un agent IA](#étape-5--créer-un-agent-ia)
- [Étape 6 — Affecter l'agent à un salon](#étape-6--affecter-lagent-à-un-salon)
- [Étape 7 — Activer le RAG du cours](#étape-7--activer-le-rag-du-cours)
- [Quand synchroniser quoi — le tableau de référence](#quand-synchroniser-quoi--le-tableau-de-référence)
- [Parler à l'agent au quotidien](#parler-à-lagent-au-quotidien)
- [Le tableau de bord et l'état des services](#le-tableau-de-bord-et-létat-des-services)
- [Dépannage express](#dépannage-express)
- [Glossaire](#glossaire)

---

## Comprendre le modèle

Tout repose sur une chaîne à six maillons. Comprendre cette chaîne évite
90 % des questions.

```
Plateforme Moodle          ex. P13LSHE — https://p1369rlshepw.unchk.sn
      │
      ├── Cours             ex. AIBOTTEST (id Moodle 952)
      │     │
      │     ├── Activité Matrix (mod_matrix)   ex. P13LSHETEST
      │     │        └── crée un ou plusieurs SALONS Matrix
      │     │            (un par groupe Moodle si l'activité est groupée)
      │     │
      │     └── Ressources pédagogiques         ex. un livre, un PDF
      │              └── alimentent le RAG du cours
      │
      └── ...

Salon Matrix ──── affectation ────> Agent IA
     │                                  │
     └── lié à UN cours ────────> RAG : le contexte que l'agent utilise
```

Trois règles à retenir :

1. **Un salon est lié à un seul cours.** L'agent qui répond dans ce salon
   ne voit que les ressources de ce cours. Jamais celles d'un autre.

2. **Un agent est réutilisable.** Le même agent affecté à dix salons de
   dix cours différents répondra à chaque fois avec le bon support. Son
   comportement (ton, consignes) est commun, son contexte documentaire
   change selon le salon.

3. **Le lien salon ↔ cours est automatique.** Le plugin Moodle inscrit
   l'identifiant du cours dans le salon à sa création ; AI Bot Manager le
   lit et fait le rapprochement. On n'intervient à la main qu'en cas
   d'anomalie.

---

## Rôles et ce que chacun peut faire

| | **ADMIN** | **MANAGER** | **ENSEIGNANT** | **AUDITEUR** |
|---|:---:|:---:|:---:|:---:|
| Plateformes Moodle — créer / modifier | ✅ | — | — | — |
| Plateformes Moodle — consulter, synchroniser | ✅ | ✅ | — | 👁 |
| Agents — créer | ✅ | ✅ | ✅ | — |
| Agents — modifier / supprimer | tous | tous | les siens | — |
| Salons — voir | tous | Moodle | ses cours | Moodle |
| Salons — affecter un agent | ✅ | ✅ | ses cours | — |
| Salons — renommer, chiffrer, indexer | ✅ | ✅ | — | — |
| Salons — **supprimer** | ✅ | — | — | — |
| Utilisateurs, paramètres | ✅ | — | — | — |

👁 = lecture seule.

Un **enseignant** ne voit que les cours où Moodle lui reconnaît le rôle
`editingteacher`, `teacher`, `tuteur` ou `tuteur suivi`, et uniquement les
salons rattachés à ces cours. Il n'a rien à configurer : son périmètre est
calculé automatiquement à partir de son compte Moodle.

---

## Étape 1 — Ajouter une plateforme Moodle

> Page **Plateformes Moodle** — réservé à l'ADMIN.

### Avant de commencer, côté Moodle

Trois choses doivent être en place. Elles sont détaillées dans
[`DEPLOYMENT.md` §5](DEPLOYMENT.md#étape-5--moodle), voici l'essentiel :

1. **Un service Web Services dédié** exposant 8 fonctions, avec l'option
   *« Can download files »* activée (sans elle, le RAG ne peut pas lire
   les PDF).

2. **Un compte de service au contexte système** — rôle Manager au niveau
   du site, pas sur des cours individuels. Un compte aux droits partiels
   ne verra qu'une partie des cours, silencieusement.

3. **Le réglage « Afficher l'identité de l'utilisateur »** doit inclure
   **l'adresse de courriel**
   (*Administration du site → Utilisateurs → Permissions → Politiques des
   utilisateurs*). Sans lui, AI Bot Manager ne peut pas relier un
   enseignant connecté à son compte Moodle, et sa page « Mes cours »
   reste vide — sans message d'erreur.

### Dans AI Bot Manager

Renseigne la clé courte (ex. `P13LSHE`), le nom, l'URL du Moodle et le
jeton du service. Le jeton est chiffré en base, il n'est jamais réaffiché.

### Vérifier tout de suite

Clique l'icône **Tester** sur la ligne de la plateforme. Le rapport
indique la connectivité, la validité du jeton, la présence du plugin
`mod_matrix` et les 8 fonctions requises.

⚠️ **Le test vérifie que les fonctions sont publiées, pas qu'elles
répondent.** Une plateforme peut afficher tout au vert et rester
inutilisable si le réglage « identité de l'utilisateur » est incomplet.
Le vrai test de bout en bout, c'est l'étape 2 puis une visite sur *Mes
cours*.

---

## Étape 2 — Synchroniser les cours

> Page **Plateformes Moodle** → icône **Synchroniser les cours** sur la
> ligne de la plateforme.

Importe la liste des cours et leurs noms. C'est le point de départ : sans
cette étape, aucune activité ni aucun salon ne pourra être rattaché.

**À relancer quand :**

- Un cours vient d'être créé côté Moodle
- Un cours a été **renommé** — c'est la seule action qui met à jour le nom
  affiché partout dans AI Bot Manager
- Un cours a été supprimé ou masqué

Cette synchronisation ne touche **pas** au contenu pédagogique des cours
(livres, PDF). Elle ne récupère que la liste et les intitulés.

---

## Étape 3 — Récupérer les activités Matrix

> Page **Plateformes Moodle** → une plateforme → **Activités** →
> bouton **Synchroniser**.

Récupère les activités `mod_matrix` créées par les enseignants dans leurs
cours, et rattache automatiquement les salons correspondants.

**À relancer quand :** un enseignant vient d'ajouter une activité Matrix
dans son cours et son salon n'apparaît pas encore.

💡 Si une activité utilise les **groupes Moodle**, elle produit un salon
par groupe (`Cours - Activité - Groupe A`, `- Groupe B`…). Chacun est
rattaché au même cours et partage donc le même RAG.

---

## Étape 4 — Importer les salons

> Page **Salons** → bouton **Synchroniser depuis Synapse**.

Importe tous les salons du serveur Matrix, détecte ceux issus de Moodle et
les relie à leur cours.

La liste est triée par défaut avec les salons **Moodle** en tête, puis les
plus récents, puis les conversations. Trois boutons permettent de changer
l'ordre.

Chaque ligne indique :

| Colonne | Signification |
|---|---|
| **Source** | 🎓 Moodle = créé par le plugin · 💬 Chat = créé dans Element |
| **Type** | Groupe ou conversation directe · 🔒 = chiffré de bout en bout |
| **Agents** | Les agents actifs dans ce salon |
| **Cours Moodle** | Le cours dont le contenu alimente le RAG |

**À relancer quand :** un salon vient d'être créé et n'apparaît pas, ou
après avoir synchronisé les activités.

---

## Étape 5 — Créer un agent IA

> Page **Agents** → **Nouvel agent**.

| Champ | À quoi ça sert |
|---|---|
| **Identifiant** | Le nom court d'appel dans les salons — `@tuteurdisidev-ia`. Non modifiable après création. |
| **Nom** | Le nom affiché dans Matrix, visible par les étudiants. |
| **Instructions** | Le cœur de l'agent : sa personnalité, sa langue, son niveau, ce qu'il doit refuser. C'est ici qu'on décrit son rôle pédagogique. |
| **Fournisseur** | **Ollama** (serveur UN-CHK, aucun coût par message, données internes) ou **Anthropic** (Claude, facturé à l'usage). |
| **Modèle** | Voir l'encadré ci-dessous. |
| **Tokens max** | Longueur maximale d'une réponse. 2048 convient à la plupart des usages. |
| **Température** | 0 = factuel et constant · 1 = créatif et variable. Laisser vide pour le réglage par défaut du modèle. |

### Choisir un modèle Ollama

Chaque modèle porte une pastille indiquant sa consommation sur le GPU
partagé :

| Pastille | Empreinte | Usage conseillé |
|---|---|---|
| **Léger** | ≤ 4,5 Go | Salons très fréquentés, questions courtes et procédurales |
| **Équilibré** | ≤ 10 Go | Recommandé pour la majorité des agents pédagogiques |
| **Lourd** | ≤ 20 Go | Raisonnement avancé, mathématiques, code — latence plus élevée |
| **Très lourd** | > 20 Go | Déconseillé : peut monopoliser le GPU et bloquer les autres agents. Une confirmation explicite est demandée. |

### Après la création

L'agent reçoit automatiquement un compte Matrix et **naît désactivé**.
C'est volontaire : on relit ses instructions, on l'affecte à un salon de
test, puis on l'active depuis sa fiche.

💡 **Modifier les instructions d'un agent ne demande aucun redémarrage.**
Le changement est pris en compte en une minute environ.

---

## Étape 6 — Affecter l'agent à un salon

> Page **Salons** → ouvrir un salon → carte **Agents IA assignés**.

Choisis l'agent dans la liste et valide. Son compte Matrix rejoint le
salon automatiquement.

Pour qu'un agent réponde, **deux conditions** doivent être réunies :

1. Son statut global est **Activé** (sur sa fiche dans *Agents*)
2. Son affectation à ce salon est **active**

Plusieurs agents peuvent cohabiter dans un même salon : chacun répond
quand on l'appelle par son identifiant.

### Si l'agent est expulsé du salon

Par défaut il **revient automatiquement**. Après trois échecs consécutifs,
l'affectation se désactive pour éviter une boucle avec un modérateur
humain. Le bouton de reconnexion manuelle, sur la carte des affectations,
remet tout à zéro.

---

## Étape 7 — Activer le RAG du cours

Le **RAG** permet à l'agent de répondre en s'appuyant sur les documents du
cours plutôt que sur ses seules connaissances générales.

### Vérifier que le salon est bien lié à son cours

> Salon → carte **Cours Moodle lié**.

Pour un salon issu de Moodle, la liste ne propose que **son** cours
d'origine — impossible de le rattacher par erreur à un autre. Si aucun
cours n'apparaît, un message explique ce qu'il reste à synchroniser, et
le bouton **Actualiser** de la carte *Administration* relance la
détection pour ce seul salon.

### Lancer l'indexation

> Salon → carte **Indexation RAG du cours** → **Réindexer le cours**.

C'est **l'étape qu'on oublie le plus souvent**. Elle enchaîne trois
opérations :

1. Import des sections et des ressources du cours depuis Moodle
2. Extraction du texte des livres, PDF, pages et dossiers
3. Calcul des empreintes sémantiques permettant la recherche

Le traitement tourne en arrière-plan : la page peut être quittée, la
barre de progression reprend à la reconnexion.

⚠️ **Tant que cette indexation n'a jamais été lancée, le cours n'a aucune
ressource dans AI Bot Manager** — même si le livre et le PDF sont bien
visibles dans Moodle. L'agent répondra alors sans contexte de cours.

### Formats exploités

| Type Moodle | Exploité | Remarque |
|---|:---:|---|
| Livre (`book`) | ✅ | Le mieux pris en charge, chapitre par chapitre |
| Fichier PDF | ✅ | Un PDF scanné sans couche texte ne donne rien |
| Page, Dossier, Étiquette | ✅ | |
| Devoir, Quiz, Forum | — | Non indexés |

### L'interrupteur d'indexation

L'interrupteur de la carte contrôle la réindexation automatique. Il
s'active tout seul dès qu'un cours contenant des ressources exploitables
est rattaché à un salon.

---

## Quand synchroniser quoi — le tableau de référence

Quatre synchronisations distinctes coexistent. Voici laquelle lancer selon
ce qui a changé.

| Ce qui a changé côté Moodle | Action à lancer | Où |
|---|---|---|
| Nouveau cours créé | **Synchroniser les cours** | Plateformes Moodle |
| **Cours renommé** | **Synchroniser les cours** | Plateformes Moodle |
| Nouvelle activité Matrix ajoutée | **Synchroniser** (activités) | Plateformes Moodle → Activités |
| Nouveau salon absent de la liste | **Synchroniser depuis Synapse** | Salons |
| **Livre ou PDF ajouté / modifié** | **Réindexer le cours** | Salon → carte RAG |
| Nouveau rôle enseignant sur un cours | **Rafraîchir depuis Moodle** | Mes cours |
| Un salon n'est pas rattaché à son cours | **Actualiser** | Salon → carte Administration |

### Ce que fait « Rafraîchir depuis Moodle »

Le bouton de la page *Mes cours* recalcule **ton périmètre d'enseignant**,
importe les salons et récupère les activités Matrix.

Il ne met **pas** à jour le nom des cours et ne relance **pas**
l'indexation RAG. Ces deux opérations ont leurs boutons dédiés.

Si une plateforme ne peut pas être interrogée, le rapport le signale
nommément avec la cause probable — plutôt que de faire disparaître ses
cours en silence.

### En pratique

- **Ajout d'un support de cours** → *Réindexer le cours*, rien d'autre
- **Création d'une activité Matrix** → *Synchroniser* les activités, puis
  *Synchroniser depuis Synapse*
- **Nouvel enseignant sur un cours** → *Rafraîchir depuis Moodle* depuis
  son compte à lui

Le périmètre d'un enseignant est mis en cache une heure. Le bouton
*Rafraîchir depuis Moodle* force le recalcul immédiat.

---

## Parler à l'agent au quotidien

Dans un salon Matrix (Element, ou l'activité Matrix depuis Moodle), on
appelle un agent par son identifiant :

```
@tuteurdisidev-ia Peux-tu me résumer le chapitre sur la configuration réseau ?
```

L'agent répond dans le salon, visible par tous. Il tient compte de
l'historique récent de la conversation.

**Poser des questions ancrées dans le cours** donne les meilleures
réponses : « quelle version d'Ubuntu est utilisée dans le guide ? » exploite
le RAG, là où « c'est quoi Linux ? » repose surtout sur les connaissances
générales du modèle.

Les **formules mathématiques** sont rendues correctement dans Element,
à condition d'activer l'option de rendu mathématique dans les paramètres
de laboratoire du client.

---

## Le tableau de bord et l'état des services

**Tableau de bord** — vue d'ensemble : nombre d'agents actifs, de salons,
de cours reliés, avec l'état de santé des services.

**Status** — page de diagnostic. Elle liste les modèles disponibles sur le
serveur d'inférence avec leur empreinte GPU, et signale les agents dont le
modèle a disparu du serveur — ceux-là échoueront au premier message.

**Mes cours** — vue de l'enseignant, en deux sections : les cours **avec**
une activité Matrix, et ceux **sans**. La seconde liste indique les cours
où il reste à créer une activité côté Moodle.

---

## Dépannage express

### L'agent ne répond pas

Vérifier dans l'ordre :

1. Son statut global est **Activé** (page *Agents*)
2. Son affectation au salon est **active**
3. Son compte est bien membre du salon (visible dans Element)
4. Son modèle existe toujours sur le serveur — la page *Status* le signale
5. Le message l'appelle bien par son identifiant exact

### L'agent répond mais ignore le contenu du cours

- La carte **Cours Moodle lié** est-elle renseignée ?
- L'indexation a-t-elle été lancée au moins une fois ? Le compteur de la
  carte RAG doit être supérieur à zéro.
- Le document est-il d'un format exploité ? Un PDF scanné ne donne rien.

### « Mes cours » est vide pour un enseignant

- Son adresse dans AI Bot Manager doit correspondre **exactement** à celle
  de son compte Moodle
- Il doit avoir un rôle d'enseignant ou de tuteur sur au moins un cours
- Cliquer **Rafraîchir depuis Moodle** : si une plateforme pose problème,
  le rapport la nomme
- Côté Moodle, vérifier le réglage « Afficher l'identité de l'utilisateur »
  (étape 1)

### Un salon n'est rattaché à aucun cours

Bouton **Actualiser** sur la carte *Administration* du salon. S'il indique
que le cours n'est pas identifiable, synchroniser les cours puis les
activités de la plateforme concernée.

### Un cours affiche encore son ancien nom

**Synchroniser les cours** sur la plateforme. C'est la seule action qui
rafraîchit les intitulés.

---

## Glossaire

| Terme | Définition |
|---|---|
| **Agent** | Assistant IA doté d'un compte Matrix, d'instructions et d'un modèle. |
| **Salon** | Espace de discussion Matrix. Créé par Moodle ou directement dans Element. |
| **Activité Matrix** | Élément ajouté dans un cours Moodle qui crée un salon et y inscrit les participants. |
| **RAG** | Technique permettant à l'agent de citer le contenu réel du cours plutôt que ses seules connaissances générales. |
| **Indexation** | Préparation des documents du cours pour la recherche : découpage puis calcul d'empreintes sémantiques. |
| **Modèle** | Le moteur de génération. Hébergé à l'UN-CHK (Ollama) ou distant (Anthropic). |
| **Périmètre enseignant** | Ensemble des cours où Moodle reconnaît à un utilisateur un rôle d'enseignant ou de tuteur. |
| **E2EE** | Chiffrement de bout en bout. Irréversible une fois activé sur un salon. |

---

*Université Numérique Cheikh Hamidou Kane — DITSI*
