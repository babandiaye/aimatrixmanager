# aibotmanager

Plateforme d'administration des **agents IA Matrix** intégrés aux cours Moodle de l'**Université Numérique Cheikh Hamidou Kane (UN-CHK)**.

Chaque agent = un compte Matrix dédié, piloté par Claude (Anthropic), capable de répondre à `@mention` dans les salons associés à des activités Moodle.

> 📘 **Pour déployer aibotmanager pas à pas** (Ubuntu vierge → premier message d'un agent), suivre [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## Sommaire

- [Architecture](#architecture)
- [Stack technique](#stack-technique)
- [Prérequis express](#prérequis-express)
- [Lancer en développement](#lancer-en-développement)
- [Mise à jour code (cycle prod)](#mise-à-jour-code-cycle-prod)
- [Bot runtime multi-agents](#bot-runtime-multi-agents)
- [Workflows](#workflows)
- [Schéma de la base de données](#schéma-de-la-base-de-données)
- [Rôles & permissions](#rôles--permissions)
- [Authentification](#authentification)
- [Sécurité — secrets stockés en DB](#sécurité--secrets-stockés-en-db)
- [Scripts utiles](#scripts-utiles)
- [Dépannage](#dépannage)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  aibotmanager (Next.js 16 + App Router)                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  Admin UI   │  │  Server      │  │  Workers / cron        │  │
│  │ (Dashboard) │  │  Actions     │  │  (sync Moodle, RAG)    │  │
│  └─────────────┘  └──────┬───────┘  └────────────────────────┘  │
└──────────────────────────┼───────────────────────────────────────┘
                           ▼
                ┌──────────────────────┐
                │  PostgreSQL 15       │  agents, rooms, audit,
                │  + pgvector 0.8      │  embeddings RAG
                └──────────┬───────────┘
                           │
       ┌───────────────────┼───────────────────────┐
       ▼                   ▼                       ▼
┌──────────────┐   ┌─────────────────┐   ┌──────────────────┐
│  Synapse     │   │  Bot runtime    │   │  Moodle Web      │
│  Admin API   │   │  (Python adapté)│   │  Services        │
└──────────────┘   └────────┬────────┘   └──────────────────┘
                            ▼
                   ┌──────────────────┐
                   │  Synapse +       │
                   │  Element Web     │
                   └──────────────────┘
```

---

## Stack technique

| Composant | Version | Rôle |
|---|---|---|
| Next.js | 16.2.4 | App Router, server actions, RSC |
| React | 19.2.4 | UI |
| TypeScript | 5.x | Typage |
| Tailwind CSS | 4 | Styling (charte UN-CHK intégrée) |
| shadcn/ui | latest | Composants UI primitifs |
| Heroicons | 2.x | Iconographie |
| Prisma | 7.8 + `@prisma/adapter-pg` | ORM |
| PostgreSQL | 15 (image `pgvector/pgvector:pg15`) | Base relationnelle + vecteurs |
| Redis | 6.x natif | Cache, rate-limit, queues |
| ioredis | 5.x | Client Redis |
| Pino | 10.x | Logs structurés (avec redaction des secrets) |
| node-cron | 4.x | Tâches planifiées |
| BullMQ | 5.x | File de jobs (pipeline d'indexation RAG en arrière-plan) |
| NextAuth (Auth.js) | 5.0-beta | Auth **Keycloak OIDC unique** |
| `@anthropic-ai/sdk` | 0.91+ | Claude API (function calling pour RAG tool-mode) |
| Ollama (compat OpenAI) | — | Serveur d'embeddings `nomic-embed-text` 768d + LLM (Gemma 3/4) |
| `matrix-nio` (Python) | 0.25+ | Client Matrix E2EE du runtime bot |
| Synapse Admin API | v1/v2 | Provisioning des comptes Matrix |
| Moodle Web Services | REST | Sync cours, ressources |
| pnpm | 10.33+ | Package manager |
| Node.js | 22 LTS | Runtime |

---

## Prérequis express

> 📘 **Pour un déploiement détaillé, suivre [`DEPLOYMENT.md`](DEPLOYMENT.md).**
> Ce qui suit est la liste résumée pour vérifier qu'on a bien tout sous la main.

### Côté machine
- Ubuntu 22.04 LTS+, Node.js **22 LTS**, pnpm **10+**, Docker + Compose, Redis 6+, nginx, certificat TLS

### Services externes
- **Synapse Matrix** déployé + access_token admin
- **Postgres 15 + pgvector 0.8** (image `pgvector/pgvector:pg15`)
- **Keycloak realm** avec client OIDC `aibotmanager` + **mapper `affiliation`** sur l'id_token (sinon tous les users sont rejetés)
- **Moodle 4.x** avec service WS dédié + 8 fonctions WS + `showuseridentity` incluant `email` (cf. [DEPLOYMENT.md §5](DEPLOYMENT.md#étape-5--moodle))
- **Plugin [`mod_matrix` (Famedly)](https://github.com/element-hq/moodle-mod_matrix)** sur chaque Moodle
- **Ollama** compat OpenAI avec `nomic-embed-text` chargé
- **Clé API Anthropic**

### Vérifier les prérequis d'une plateforme Moodle

**Via l'UI** — bouton **Tester** (icône bécher) sur chaque ligne de `/moodle` : lance en un clic la batterie de checks côté serveur (connectivité, token, plugin `mod_matrix`, fonctions WS, appel réel de `mod_matrix_get_matrices_by_courses`) et affiche un rapport structuré avec ✅ / ⚠️ / ❌ par item.

**Contrat d'intégration côté Moodle admin** — le token de la plateforme doit avoir accès à ces **8 fonctions WS** (à cocher dans *Admin site → Web services → Services externes → Fonctions*) :

| Fonction | Utilisée par |
|---|---|
| `core_webservice_get_site_info` | Bouton Tester (connectivité + liste des fonctions) |
| `core_course_get_courses` | Sync des cours de la plateforme |
| `core_course_get_courses_by_field` | Sync des cours (variante) |
| `core_course_get_contents` | Indexation RAG (livres, ressources) |
| `core_user_get_users_by_field` | Résolution enseignant par email Keycloak |
| `core_enrol_get_users_courses` | Liste des cours d'un enseignant |
| `core_enrol_get_enrolled_users` | Détection des rôles enseignant/tuteur sur un cours |
| `mod_matrix_get_matrices_by_courses` | Activités `mod_matrix` + auto-link salons ↔ cours |

**En ligne de commande** (alternative CI/scripting) :

```bash
pnpm exec tsx scripts/test-moodle-functions.ts
```

### Au-delà des fonctions : les réglages de site Moodle

Cocher les 8 fonctions **ne suffit pas**. Deux réglages côté Moodle conditionnent le bon fonctionnement, et leur absence est **silencieuse** — le bouton *Tester* passe au vert alors que `/mes-cours` reste vide.

| Réglage | Où | Pourquoi c'est indispensable |
|---|---|---|
| **`showuseridentity` doit inclure `email`** | *Admin site → Utilisateurs → Permissions → Politiques des utilisateurs → Afficher l'identité de l'utilisateur* | `core_user_get_users_by_field` avec `field=email` retourne **un tableau vide** (pas une erreur) si `email` n'est pas dans cette liste. La résolution enseignant échoue donc pour toute la plateforme. Le champ `email` disparaît aussi des objets utilisateur retournés. |
| **Compte WS avec droits suffisants** | *Admin site → Web services → Gérer les jetons* | Le compte rattaché au token doit voir les utilisateurs et les cours au **contexte système** (typiquement l'admin du site, `userid=2`, ou un rôle Manager système). Un compte ordinaire produit des `warnings: "No access rights in course context"` et ne voit qu'une partie des cours. |

**Diagnostic rapide** — si `field=email` renvoie `[]` alors que `field=id` ou `field=username` renvoient l'utilisateur, c'est le gate `showuseridentity` :

```bash
# Remplacer <BASE_URL>, <TOKEN>, <EMAIL>
curl -s "<BASE_URL>/webservice/rest/server.php?wstoken=<TOKEN>\
&wsfunction=core_user_get_users_by_field&moodlewsrestformat=json\
&field=email&values[0]=<EMAIL>"
# → []         : showuseridentity ne contient pas `email` → à corriger
# → [{...}]    : OK
```

Après correction côté Moodle, le cache teacher-scope (TTL 1 h) doit être vidé : bouton **Rafraîchir depuis Moodle** sur `/mes-cours`.

---

## Lancer en développement

```bash
pnpm install --frozen-lockfile
cp .env.example .env && chmod 600 .env   # remplir les valeurs (cf. DEPLOYMENT.md §7.3)
pnpm db:push                              # 17 tables
pnpm dev                                  # http://localhost:3000 (Turbopack)
```

Hot-reload Turbopack. Les changements de schéma Prisma nécessitent `pnpm db:push && pnpm exec prisma generate`.

### Tests smoke (sans bot Matrix)

```bash
pnpm exec tsx scripts/smoke-test.ts                # DB + Redis + Prisma
pnpm exec tsx scripts/test-moodle.ts               # WS Moodle (toutes plateformes actives)
pnpm exec tsx scripts/test-moodle-functions.ts     # fonctions WS autorisées par chaque token
```

---

## Mise à jour code (cycle prod)

```bash
cd /var/www/html/aimatrixmanager
git pull
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm db:push                       # si le schéma a changé
pnpm build
sudo systemctl restart aimatrixmanager

# Uniquement si le code Python du bot a changé (pas pour un nouvel
# agent / un changement de prompt — ça, c'est hot-rechargé tout seul) :
cd /opt/matrix-synapse && sudo docker compose up -d --build bot-ia
```

Pour un déploiement initial complet (machine vierge) ou la rotation de
secrets, voir [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## Bot runtime multi-agents

Le **bot Python** ([`bot/`](bot/) dans ce repo) est le runtime qui fait tourner les agents IA. Il :

- Lit la table `Agent` (status=`ENABLED`) au démarrage
- Spawn N tâches asyncio, **une par agent**, chacune avec son propre `AsyncClient` matrix-nio
- Pour chaque agent : restore_login avec le `matrixAccessToken` (déchiffré à la volée) et son `matrixDeviceId`
- Store olm/E2EE persisté dans `/app/store/<slug>/` (un sous-dossier par agent)

À chaque message reçu :

1. Si la room n'a pas de `RoomAgent` (enabled) pour cet agent → ignoré
2. **DM** (≤ 2 membres) → toujours répondre
3. **Groupe** → mention de l'agent requise (slug, MXID, displayname, `m.mentions`, pill)
4. La mention est strippée du body
5. **Phase « réflexion »** : un placeholder `💭 Réfléchit . . .` est envoyé avec :
   - une **animation interne** qui cycle l'emoji et les points toutes les ~650 ms (effet « pulse »)
   - l'**indicateur natif Matrix** `room_typing` (Element affiche « X écrit… » avec 3 points animés en bas du salon)
6. **Routage RAG** (si le salon est lié à un `MoodleCourse` avec `reindexEnabled`) :
   - provider `ANTHROPIC` → **tool-mode** : Claude appelle dynamiquement `search_course` / `get_chapter`
   - provider `OLLAMA` → **RAG naïf** : top-K chunks injectés dans le system prompt
   - sinon → mode standard sans contexte
7. Appel LLM en **streaming** : tokens éditent le placeholder au fil de l'arrivée (throttle 400 ms / 25 chars)
8. À la fin du stream : typing indicator coupé, message final consolidé
9. Insert dans `AuditLog` : tokens, latence, erreur éventuelle

**Cycle de vie côté UI** :

| Action | Conséquence côté Matrix |
|---|---|
| Création d'un agent (`/agents/new`) | Compte Matrix provisionné via Synapse Admin API + client login → access_token + device_id chiffrés en DB |
| Statut `ENABLED` | Le bot **détecte automatiquement** le nouvel agent et le lance (reconcile loop, voir ci-dessous) |
| Assignation à une room (`/rooms/[id]`) | `joinUserToRoom` admin force le bot à rejoindre |
| Désassignation | Le bot quitte la room avec son propre token |
| Bouton « Régénérer token » | Reset password admin → client login → nouveau token + device — pris en compte au prochain tick reconcile |

### Hot-reload — pas besoin de redémarrer

Le bot embarque une **reconcile loop** ([bot/main.py](bot/main.py)) qui re-scanne la table `Agent` à intervalle régulier et :
- spawn un runner pour tout nouvel agent `ENABLED`
- arrête proprement les runners dont l'agent est passé à `DISABLED`
- swappe les champs hot-reloadables (`systemPrompt`, `model`, `temperature`, `maxTokens`, `displayName`) sans relancer la session Matrix
- recrée le client si le `matrixAccessToken` a été régénéré (rotation de token)

Chaque agent envoie aussi un **heartbeat** dans `Agent.lastHeartbeatAt` (sert au check « Bot multi-agents » du dashboard `/health`).

#### Arrêt d'un runner — pourquoi `shutdown()` existe

`run()` lance `keys_loop` et `heartbeat_loop` via `asyncio.create_task` : ce sont des tâches **indépendantes**, qu'annuler `run()` ne touche pas. Tout arrêt de runner passe donc par `AgentRunner.shutdown()`, qui les annule avant de fermer la session Matrix.

Sans ça, un runner arrêté (agent `DISABLED`, rotation de token, crash) laissait derrière lui deux boucles zombies :

| Boucle survivante | Symptôme observable |
|---|---|
| `keys_loop` | `POST /keys/query → 401` toutes les 5 min dans les logs Synapse, indéfiniment (jeton révoqué) |
| `heartbeat_loop` | `Agent.lastHeartbeatAt` continuait d'être écrit — **un agent mort s'affichait vivant** sur `/health` |

Le chemin « runner terminé inopinément » de la reconcile loop appelle lui aussi `_stop_runner` : un crash de `run()` ne dit rien de ses tâches filles, qui tournent toujours.

Signe qu'une régression est réapparue — après une rotation de token, chercher :

```bash
sudo grep "Invalid access token passed" /var/log/matrix-synapse/homeserver.log | grep keys/query
```

Toute occurrence postérieure à un `🔄 Restart runner` est un orphelin.

Un redémarrage manuel (`sudo docker restart bot-ia`) n'est nécessaire qu'après une modif du **code Python** :

```bash
cd /opt/matrix-synapse && sudo docker compose up -d --build bot-ia
```

---

## Workflows

### Première mise en service (admin)

```
1. Login Keycloak (le tout premier user est promu ADMIN automatiquement)
2. /moodle → ajouter une plateforme (clé + URL + token WS)
   → cf. section Moodle — service Web Services pour les fonctions à activer
3. /moodle → bouton 🔄 → sync des cours dans MoodleCourse
4. /moodle/[id]/activities → bouton Synchroniser
   → importe les MoodleMatrixActivity + lie les Room ↔ MoodleCourse
5. /rooms → bouton « Synchroniser depuis Synapse » (découvre toutes les rooms)
6. /agents → créer un agent (slug, prompt, modèle) → ENABLED
   → le bot Python le détecte tout seul (reconcile loop, pas de restart)
7. /rooms/[id] → assigner l'agent + lier au cours Moodle si non auto-lié
   → la liste de cours proposée est filtrée aux cours ayant ≥ 1 activité
     mod_matrix (et une confirmation avant lien)
8. /rooms/[id] → activer l'indexation RAG → un job BullMQ tourne en arrière-plan
9. Élève écrit `@<slug> bonjour ...` dans Element → l'agent répond
10. /audit → contrôle pédagogique des conversations
11. /health → dashboard "État des services" (Postgres, Redis, Synapse,
    bot multi-agents, Ollama, plateformes Moodle)
```

### Flow ENSEIGNANT (auto-service)

```
1. Admin promeut l'utilisateur ENSEIGNANT dans /users
2. L'ENSEIGNANT se connecte (Keycloak — son email doit matcher son compte Moodle)
3. /mes-cours → résolution auto via WS (cache 1h, invalidable via le bouton
   "Rafraîchir depuis Moodle") → liste des cours où il est editingteacher,
   teacher, tuteur ou tuteur_suivi. Deux sections : cours avec activité
   Matrix (actionnables) vs sans (grisés, incitent à créer un mod_matrix
   côté Moodle).
4. /agents/new → crée son propre agent IA (slug, prompt, modèle)
5. /agents/[id]/edit → peut modifier ses propres agents (canAny "agents.update-own")
6. /rooms → voit uniquement les salons Moodle de ses cours
7. /rooms/[id] → assigne son agent au salon (sélecteur scopé à ses agents)
8. Le bot répond aux mentions dans le salon — pas de redémarrage requis,
   le reconcile loop prend la nouvelle assignation au tick suivant
```

Les rôles Moodle acceptés sont extensibles sans toucher au code via l'env
`MOODLE_TEACHER_ROLES="autre,rôle,csv"` — utile si l'instance UN-CHK ajoute
un rôle pédagogique custom.

Le bouton **Rafraîchir depuis Moodle** en tête de `/mes-cours` déclenche
en séquence : invalidation du cache teacher-scope perso, import des
nouveaux salons Synapse, sync des activités `mod_matrix` (avec auto-link
Room ↔ MoodleCourse). Utile après création d'une activité côté Moodle,
d'un ajout d'enseignant dans un cours, ou après le cron de nuit qui
resynchronise les comptes Matrix côté Moodle.

> Pour le cycle de mise à jour du code → section [Mise à jour code (cycle prod)](#mise-à-jour-code-cycle-prod) plus haut.

---

## Schéma de la base de données

17 tables (voir [`prisma/schema.prisma`](prisma/schema.prisma)) :

**Auth / utilisateurs**

| Table | Rôle |
|---|---|
| `User` | Comptes ADMIN/MANAGER/ENSEIGNANT/AUDITOR + `moodleUserMap` (cache résolution prof) |
| `Account` `Session` `VerificationToken` | NextAuth (OIDC liaison) |
| `AuthAuditLog` | Journal des logins (success/fail, provider, IP) |
| `SystemSettings` | Config runtime (toggle Keycloak) |

**Agents IA Matrix**

| Table | Rôle |
|---|---|
| `Agent` | Bots IA (slug, MXID, prompt, modèle, statut, `matrixAccessToken` chiffré, `createdById`) |
| `AgentCrossSigning` | Clés Ed25519 master/SSK/USK pour le cross-signing E2EE |

**Moodle**

| Table | Rôle |
|---|---|
| `MoodlePlatform` | Instances Moodle (clé, URL, `wsToken` chiffré) |
| `MoodleCourse` | Cours synchronisés depuis Moodle (`reindexEnabled` pour RAG) |
| `MoodleMatrixActivity` | Activités du plugin `mod_matrix` (Famedly) — sync via `mod_matrix_get_matrices_by_courses` |

**Salons Matrix**

| Table | Rôle |
|---|---|
| `Room` | Salons Matrix découverts (`source` = MATRIX ou MOODLE, lien optionnel à un `MoodleCourse`) |
| `RoomAgent` | Affectation salon ↔ agent (`enabled` togglable) |
| `AuditLog` | Conversation : sender, message, réponse, tokens, latence |

**RAG (Phase 11)**

| Table | Rôle |
|---|---|
| `MoodleSection` | Sections (chapitres) d'un cours Moodle |
| `MoodleResource` | Ressources (fichiers PDF/DOCX, pages, labels, books, folders) avec `extractedText` et `contenthash` SHA1 |
| `MoodleResourceChunk` | Chunks de ~1000 chars + `embedding vector(768)` (HNSW pgvector cosine) pour la recherche sémantique |

---

## Rôles & permissions

| Action | Admin | Manager | Enseignant | Auditor |
|---|:---:|:---:|:---:|:---:|
| CRUD utilisateurs | ✅ | — | — | — |
| Settings système (toggle Keycloak) | ✅ | — | — | — |
| **CRUD plateformes Moodle** | ✅ | lecture | — | lecture |
| Sync mod_matrix activities (par plateforme) | ✅ | ✅ | — | — |
| Sync rooms depuis Synapse (global) | ✅ | ✅ | — | — |
| Créer un agent IA | ✅ | ✅ | ✅ | — |
| Modifier / supprimer ses propres agents | ✅ | ✅ | ✅ (siens) | — |
| Modifier / supprimer tous les agents | ✅ | ✅ | — | — |
| Voir tous les salons | ✅ | ✅ | — | ✅ |
| Voir uniquement ses salons (Moodle scope) | — | — | ✅ | — |
| Affecter un agent à un salon | ✅ | ✅ | ✅ (ses agents → ses salons) | — |
| Lier une room à un cours (cross-cours) | ✅ | ✅ | — | — |
| Activer E2EE / renommer un salon | ✅ | ✅ | — | — |
| Indexation RAG d'un cours | ✅ | ✅ | — | — |
| Consulter logs d'audit | ✅ | ✅ | — | ✅ |
| Supprimer logs d'audit | ✅ | — | — | — |
| Default nouveaux comptes Keycloak | — | — | — | ✅ |

> Le scope ENSEIGNANT est calculé à partir de l'**email Keycloak** : on retrouve le user Moodle correspondant et la liste des cours où il a le rôle `editingteacher` ou `teacher`. Résolution cachée 1h dans `User.moodleUserMap` + `User.lastMoodleSyncAt`. Cf. [src/lib/teacher-scope.ts](src/lib/teacher-scope.ts).

Implémentation : [src/lib/permissions.ts](src/lib/permissions.ts)

---

## Authentification

**Provider unique : Keycloak OIDC.** Il n'y a plus de provider Credentials ni de fallback local — toutes les sessions transitent par Keycloak.

```
Cas de figure                                      Effet
─────────────────────────────────────────────────  ──────────────────────────────────────
KEYCLOAK_* set + service Keycloak joignable        Login normal
KEYCLOAK_* manquants ou vides                      L'app ne démarre pas (fail-fast)
Service Keycloak indispo                           /login renvoie une erreur (aucune route locale)
```

Le **rôle est toujours rechargé depuis la DB** au login (Keycloak ne peut pas dicter de rôle).

**Bootstrap** :
- Le **tout premier utilisateur** qui se connecte via Keycloak est promu **ADMIN automatiquement** (cas spécial bootstrap d'une instance vide).
- Les utilisateurs suivants sont créés avec le rôle `AUDITOR` → un ADMIN doit les promouvoir via `/users`.

`auth.config.ts` est volontairement edge-safe (pas d'import Prisma) car NextAuth charge le middleware en Edge runtime. Les callbacks DB-touchants (jwt refresh, events) sont dans `auth.ts`.

### Backchannel logout

À la déconnexion UI, l'app appelle l'endpoint OIDC RP-Initiated Logout de Keycloak côté serveur (silent, sans suivre la redirection), puis purge la session Next. Voir [src/auth.ts](src/auth.ts).

---

## Sécurité — secrets stockés en DB

| Secret | Stockage | Affichage UI |
|---|---|---|
| `User.passwordHash` | bcrypt 12 | jamais |
| `MoodlePlatform.wsToken` | **AES-256-GCM** (`enc:v1:` + base64) | jamais |
| `Agent.matrixAccessToken` | **AES-256-GCM** | jamais |
| `Agent.matrixDeviceId` | clair (non sensible) | masqué |

Implémentation : [src/lib/crypto.ts](src/lib/crypto.ts) avec versioning `enc:v1:`. Migration des tokens existants : `pnpm exec tsx scripts/migrate-ws-tokens.ts`.

Logs **pino** redactent automatiquement `*.password`, `*.token`, `*.access_token`, `Authorization`, `Cookie`. Voir [src/lib/logger.ts](src/lib/logger.ts).

---

## Scripts utiles

| Commande | Effet |
|---|---|
| `pnpm dev` | Dev server (Turbopack) |
| `pnpm build` | Build production |
| `pnpm start` | Lance le build (utilisé par systemd) |
| `pnpm lint` | ESLint |
| `pnpm db:push` | Sync schema Prisma → Postgres (dev) |
| `pnpm db:studio` | Prisma Studio sur la DB |
| `pnpm exec tsx scripts/smoke-test.ts` | Vérifie DB + Redis + Prisma |
| `pnpm exec tsx scripts/test-moodle.ts` | Teste les WS Moodle (toutes plateformes actives) |
| `pnpm exec tsx scripts/test-moodle-functions.ts` | Liste les fonctions WS autorisées par le token |
| `pnpm exec tsx scripts/cross-signing.ts setup <slug>` | Initialise le cross-signing E2EE d'un agent (évite le bouclier rouge Element) |

---

## Dépannage

### Le service ne démarre pas (203/EXEC)
- `which pnpm` doit retourner `/usr/bin/pnpm`. Sinon : `sudo npm install -g --prefix=/usr pnpm`.
- Le service nécessite un build (`pnpm build`) avant `systemctl start`.

### `Failed to fetch Geist from Google Fonts` au build
- L'environnement n'a pas accès à fonts.googleapis.com (firewall sortant). Le projet utilise `system-ui` — vérifier qu'aucun import `next/font/google` n'a été réintroduit.

### `pgvector` non disponible
- Vérifier que l'image Docker est bien `pgvector/pgvector:pg15` et pas `postgres:15` :
  ```bash
  sudo docker inspect synapse-postgres --format '{{.Config.Image}}'
  ```

### Token Moodle invalide / `accessexception`
- Le service externe Moodle doit autoriser explicitement chaque `wsfunction` utilisée. Vérifier dans Moodle : *Site administration → Plugins → Web services → External services → Functions* (cf. liste détaillée en section [Moodle — service Web Services](#moodle--service-web-services)).
- Si le download des PDF échoue avec `accessexception`, c'est que **« Can download files »** n'est pas coché sur le service externe.

### `/mes-cours` vide pour un ENSEIGNANT
- L'email Keycloak de l'user doit correspondre **exactement** à son email Moodle (le matching est strict).
- Le user doit avoir le rôle Moodle `editingteacher` ou `teacher` dans au moins un cours.
- Le service WS doit avoir les 3 fonctions `core_user_get_users_by_field`, `core_enrol_get_users_courses`, `core_enrol_get_enrolled_users`.
- **`showuseridentity` doit inclure `email`** côté Moodle — sinon `core_user_get_users_by_field(field=email)` retourne `[]` sans erreur, `resolveTeacherCourseIds` fait un `continue` muet et la plateforme **n'apparaît jamais** dans `User.moodleUserMap`. Voir [§ Au-delà des fonctions](#au-delà-des-fonctions--les-réglages-de-site-moodle).
- Le cache est de 1h dans `User.moodleUserMap` — pour forcer un refresh : bouton **Rafraîchir depuis Moodle** sur `/mes-cours`, ou `UPDATE "User" SET "lastMoodleSyncAt" = NULL WHERE email = '<email>';`

**Isoler la plateforme fautive** — comparer les clés présentes dans le cache avec les plateformes activées :

```sql
SELECT p.key,
       (u."moodleUserMap" ? p.id) AS resolue
FROM "MoodlePlatform" p
CROSS JOIN "User" u
WHERE p.enabled AND u.email = '<email>';
```

Une plateforme à `resolue = false` n'a pas pu résoudre le compte : vérifier `showuseridentity` et les droits du compte WS sur celle-ci.

### Une activité mod_matrix créée côté Moodle n'apparaît pas dans `/moodle/[id]/activities`
- La synchro mod_matrix est manuelle : aller sur `/moodle/[id]/activities` → bouton **Synchroniser**.
- Le service WS doit avoir `mod_matrix_get_matrices_by_courses` (sinon `accessexception`).
- Si l'activité est en mode `target=element-url` (URL Element au lieu de room Matrix native), le `matrix_room_id` est vide côté Moodle → on fait un fallback fuzzy par nom de room. Si plusieurs candidats matchent, le lien est skip (logué en warn).

### Un salon Moodle n'est pas lié à son cours (`source=MATRIX` ou `Cours Moodle` vide)

Trois causes possibles, par ordre de fréquence :

1. **Mode `target=element-url` + activité multi-groupes.** Le plugin crée un salon par groupe Moodle (`Cours - Activité - Groupe A`, `- Groupe B`) mais laisse `matrix_room_id` vide dans sa table. Le lien direct échoue, et le fallback fuzzy par nom trouve **plusieurs** candidats (tous contiennent le nom de l'activité) → il renonce par prudence. Résultat : les salons de groupe restent non liés.

2. **Collision de `moodleId` entre plateformes.** Deux Moodle distincts peuvent avoir un cours portant le même identifiant numérique (ex. `moodleId=50` sur deux plateformes). La résolution via le marqueur Matrix `org.matrix.moodle.course_id` trouve alors 2 candidats et refuse de lier (logué en warn).

3. **Le cours n'est pas encore synchronisé** dans AI Bot Manager — lancer d'abord la sync des cours sur `/moodle`.

**Contournement immédiat** : sur `/rooms/[id]`, carte *Administration* → bouton **Actualiser** (relance la détection pour ce seul salon), ou sélectionner le cours à la main dans *Cours Moodle lié*.

**Marqueurs posés par le plugin** dans le `content` de l'événement `m.room.create` — utiles pour diagnostiquer :

```jsonc
{
  "org.matrix.moodle.course_id": 50,   // cours d'origine
  "org.matrix.moodle.group_id": 15     // groupe Moodle (activités multi-groupes)
}
```

À lire via l'API admin Synapse :

```bash
curl -s "$MATRIX_HOMESERVER/_synapse/admin/v1/rooms/$(python3 -c \
  "import urllib.parse;print(urllib.parse.quote('<ROOM_ID>',safe=''))")/state" \
  -H "Authorization: Bearer $SYNAPSE_ADMIN_TOKEN" \
  | python3 -c "import json,sys;print([e['content'] for e in json.load(sys.stdin)['state'] if e['type']=='m.room.create'])"
```

La réponse de `mod_matrix_get_matrices_by_courses` expose par ailleurs `wwwroot` (URL de la plateforme, lève la collision du point 2) et `activity_uid` (identifiant stable globalement unique de l'activité).

### Synapse `429 Too Many Requests` lors de la création d'une activité mod_matrix
- Le plugin invite tous les inscrits du cours d'un coup → dépasse les rate limits `rc_invites` par défaut. Augmenter dans `/etc/matrix-synapse/homeserver.yaml` :
  ```yaml
  rc_invites:
    per_room:  { per_second: 5, burst_count: 100 }
    per_user:  { per_second: 1, burst_count: 50 }
    per_issuer: { per_second: 5, burst_count: 100 }
  ```
  puis `sudo systemctl restart matrix-synapse`.

### Bot Matrix expulsé d'un salon (« kicked »)
- État membre `leave` avec un `sender` ≠ MXID du bot dans les events `/messages` Synapse Admin = kick administratif.
- Réintégration : `POST /_synapse/admin/v1/join/{roomId}` avec le `user_id` du bot (`src/lib/synapse-admin.ts::joinUserToRoom`).
- Le reconcile loop **ne re-rejoint pas tout seul** un bot kické (par sécurité — on ne veut pas qu'un bot s'incruste après éviction).

### Bot répond `⏳ Le modèle est en train de démarrer` (timeout Ollama)

**Le cas le plus fréquent.** Le message est spécifique aux timeouts — un vrai plantage renvoie `❌ Désolé, je rencontre un problème technique`.

Signature dans les logs : exactement **120 s** entre la question et l'erreur (la valeur de `httpx.AsyncClient(timeout=120)` dans [bot/llm.py](bot/llm.py)).

```
16:09:38  @user → !room [GROUP] : résous l'équation …
16:11:38  Streaming LLM (OLLAMA) : ReadTimeout
```

**Cause** — le modèle n'est plus résident en VRAM sur `fromager` et se recharge. Mesuré le 11/08/2026 :

| | Premier jeton |
|---|---:|
| Modèle absent de la mémoire | **43,8 s** |
| Requête suivante, modèle chaud | **0,5 s** |

Ce n'est **pas** une expiration de `keep_alive` (réglé à 24 h) mais une **éviction** : les six modèles de `fromager` se disputent la même carte.

```bash
# Qui est résident, et pour combien de VRAM ?
curl -sH "Authorization: Bearer $OLLAMA_API_KEY" "$OLLAMA_BASE_URL/api/ps" | jq \
  '.models[] | {name, size_vram, context_length, expires_at}'
```

L'anomalie à surveiller : `gemma3:12b` pèse 8,1 Go sur disque mais occupe **48,8 Go en VRAM**, parce que son `context_length` vaut `131072`. Les agents plafonnent à `maxTokens=2048` — cette fenêtre ne sert à rien et empêche tout autre modèle de coexister.

- **Correctif durable** (côté `fromager`, hors de ce repo) : réduire `num_ctx` de `gemma3:12b` à 8 K–16 K, ou fixer `OLLAMA_MAX_LOADED_MODELS`.
- **Contournement immédiat** : pointer l'agent sur un autre modèle (`/agents/[id]/edit`).
- Le dashboard `/health` → carte « Ollama (fromager) » ne détecte **pas** ce cas : `/v1/models` répond en 0,08 s même quand le modèle est déchargé.

### Une erreur LLM apparaît sans cause dans les logs ou dans `AuditLog`

Ne doit plus arriver. `str()` est **vide** sur plusieurs exceptions `httpx` (`ReadTimeout`, `ConnectTimeout`…), ce qui produisait la ligne muette `Streaming LLM (OLLAMA) : ` et un champ `AuditLog.error` sans contenu.

Tout report d'erreur LLM passe désormais par `describe_exc()` ([bot/main.py](bot/main.py)), qui préfixe systématiquement par le type. Si une ligne d'erreur réapparaît sans cause, c'est qu'un chemin a contourné ce helper.

### Indexation RAG bloquée à 0% / barre infinie sur `/rooms/[id]`
- Vérifier l'état du worker BullMQ dans Redis :
  ```bash
  redis-cli LLEN bull:rag-indexer:waiting
  redis-cli LLEN bull:rag-indexer:active
  ```
- Le worker est lancé via `src/instrumentation.ts` (runtime Node only) ; vérifier qu'il n'a pas crashé (`pnpm start` log).
- Le composant `RagIndexer` ne reload la page **qu'après avoir observé la transition active → completed** dans la session courante (sinon boucle infinie, car BullMQ garde l'état `completed` 24h).
- Pour purger un job stuck : `redis-cli DEL bull:rag-indexer:<jobId>` puis relancer depuis l'UI.

### Livre Moodle (mod_book) indexé partiellement
- Avant le patch multi-fichiers, seul le premier chapitre était extrait. Si tu vois 1 chunk pour un book de 16 chapitres :
  - vérifier que `MoodleResource.files` (Json) est rempli pour la ressource concernée
  - re-déclencher une réindexation complète depuis `/rooms/[id]` (bouton « Réindexer le cours »)

### `permission denied` à `pnpm build`
- `.next/` peut hériter d'ownership root suite à un mauvais build :
  ```bash
  sudo chown -R pabn:pabn /var/www/html/aimatrixmanager/.next
  ```

### Le rôle d'un user n'est pas pris en compte
- Le rôle est dans le **JWT de session**, rechargé uniquement à chaque login. Demander à l'utilisateur de se déconnecter/reconnecter.

---

## Crédits

Développé par la **DITSI – UN-CHK** (Direction des Infrastructures et des Systèmes d'Information — Université Numérique Cheikh Hamidou Kane).

© SISS - DITSI – UN-CHK – 2026 – Tous droits réservés
