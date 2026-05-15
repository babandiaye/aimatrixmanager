# aibotmanager

Plateforme d'administration des **agents IA Matrix** intégrés aux cours Moodle de l'**Université Numérique Cheikh Hamidou Kane (UN-CHK)**.

Chaque agent = un compte Matrix dédié, piloté par Claude (Anthropic), capable de répondre à `@mention` dans les salons associés à des activités Moodle.

---

## Sommaire

- [Architecture](#architecture)
- [Stack technique](#stack-technique)
- [Prérequis](#prérequis)
  - [Moodle — service Web Services](#moodle--service-web-services)
- [Installation](#installation)
- [Configuration `.env`](#configuration-env)
- [Lancer en développement](#lancer-en-développement)
- [Déploiement production (systemd)](#déploiement-production-systemd)
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
| NextAuth (Auth.js) | 5.0-beta | Auth Credentials + Keycloak OIDC |
| `@anthropic-ai/sdk` | 0.91+ | Claude API |
| Synapse Admin API | v1/v2 | Provisioning des comptes Matrix |
| Moodle Web Services | REST | Sync cours, ressources |
| pnpm | 10.33+ | Package manager |
| Node.js | 22 LTS | Runtime |

---

## Prérequis

### Système
- Linux (testé sur Ubuntu 22.04+)
- Node.js **22 LTS** (via `nvm` recommandé)
- pnpm **10+** : `npm install -g --prefix=/usr pnpm`
- Docker + Docker Compose (pour Postgres pgvector)
- Redis natif **6+** (`apt install redis-server`)
- nginx ou autre reverse-proxy pour la prod (TLS)

### Services externes
- **Synapse / Matrix** déployé et joignable en HTTP local
- **Compte Synapse admin** avec un access token dédié (utilisé pour provisionner les agents)
- **Moodle 4.x** avec **Web Services activés** et un **service externe** créé pour aibotmanager (cf. section [Moodle — service Web Services](#moodle--service-web-services) plus bas)
- **Plugin [`mod_matrix` (Famedly)](https://github.com/element-hq/moodle-mod_matrix)** installé sur chaque Moodle, si on veut détecter les activités Matrix créées depuis les cours
- **Clé API Anthropic** (`ANTHROPIC_API_KEY`)
- **Serveur d'embeddings** compatible OpenAI servant un modèle (recommandé : `nomic-embed-text` 768-dim sur Ollama avec GPU)
- **Realm Keycloak** (optionnel) avec un client OIDC dont le `redirect URI` pointe vers `<base-url>/api/auth/callback/keycloak`

### Moodle — service Web Services

aibotmanager interroge chaque Moodle via un **service externe dédié** (par exemple `BBBmanager`) avec un compte service (rôle Manager au niveau site). Crée le service dans *Site administration → Server → Web services → External services → Add*.

**Réglages du service :**

| Option | Valeur | Pourquoi |
|---|---|---|
| Enabled | ✅ | Indispensable |
| Authorized users only | ✅ | Limite à un compte service dédié |
| Can download files | ✅ | Requis pour extraire les PDF/DOCX dans le RAG (sinon `accessexception` au téléchargement) |
| Can upload files | ❌ | Non utilisé |

**Fonctions à ajouter** (onglet *Functions*) :

| Fonction WS | Où c'est utilisé | Obligatoire ? |
|---|---|:---:|
| `core_course_get_courses_by_field` | Sync des cours d'une plateforme (`/moodle/[id]` → bouton 🔄) | ✅ |
| `core_course_get_contents` | Sync structurel d'un cours (sections + modules) pour le RAG | ✅ |
| `core_user_get_users_by_field` | Résolution rôle ENSEIGNANT : retrouver l'user Moodle à partir de son email Keycloak | ✅ (si ENSEIGNANT activé) |
| `core_enrol_get_users_courses` | Liste des cours où l'utilisateur est inscrit | ✅ (si ENSEIGNANT activé) |
| `core_enrol_get_enrolled_users` | Lecture des rôles Moodle dans un cours (filtre `editingteacher`/`teacher`) | ✅ (si ENSEIGNANT activé) |
| `mod_matrix_get_matrices_by_courses` | Sync des activités Matrix (mod_matrix Famedly) → lien Room ↔ Cours | ✅ (si mod_matrix utilisé) |

> ℹ️ Sans `mod_matrix_get_matrices_by_courses`, les rooms créées depuis Moodle resteront en `source=MATRIX` (non liées au cours) et l'ENSEIGNANT ne les verra pas dans `/mes-cours` ni dans `/rooms`.

> ℹ️ Sans les 3 fonctions `core_user_*` et `core_enrol_*`, le rôle **ENSEIGNANT** ne fonctionnera pas — la résolution des cours où l'utilisateur est prof se fera silencieusement vide (`/mes-cours` affichera "Aucun cours trouvé").

**Génération du token :** *Site administration → Server → Web services → Manage tokens → Create token*, en sélectionnant le service `BBBmanager` et le compte service. Reporte la valeur dans l'UI `/moodle/new` (le token est chiffré AES-256-GCM en DB).

**Vérification rapide** depuis le serveur :

```bash
pnpm exec tsx scripts/test-moodle-functions.ts   # liste toutes les fonctions autorisées par le token
```

---

## Installation

### 1. Récupérer le code

```bash
sudo mkdir -p /var/www/html/aimatrixmanager
sudo chown -R $USER:$USER /var/www/html/aimatrixmanager
cd /var/www/html/aimatrixmanager
# (cloner ou copier les sources ici)
pnpm install
```

### 2. Préparer Postgres avec pgvector

Si tu as déjà un conteneur `postgres:15`, switche son image vers `pgvector/pgvector:pg15` (compatible binaire, pas de perte de données) :

```bash
# Backup avant modification
sudo docker exec synapse-postgres pg_dumpall -U <admin_user> > /tmp/pgbackup.sql

# Dans /opt/.../docker-compose.yml :
#   image: postgres:15  →  image: pgvector/pgvector:pg15
sudo docker compose up -d postgres

# Vérifier
sudo docker exec synapse-postgres psql -U <admin_user> -d postgres \
  -c "SELECT * FROM pg_available_extensions WHERE name='vector';"
```

### 3. Créer la DB et le user dédiés

```bash
DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
echo "$DB_PASS"  # à reporter dans .env

sudo docker exec synapse-postgres psql -U <admin_user> -d postgres <<EOF
CREATE USER aimatrix_user WITH PASSWORD '$DB_PASS';
CREATE DATABASE aimatrixmanager OWNER aimatrix_user;
EOF

sudo docker exec synapse-postgres psql -U <admin_user> -d aimatrixmanager <<EOF
CREATE EXTENSION vector;
GRANT ALL PRIVILEGES ON SCHEMA public TO aimatrix_user;
EOF
```

### 4. Variables d'environnement

```bash
cp .env.example .env
# remplir les valeurs (voir section ci-dessous)
chmod 600 .env
```

### 5. Schéma + admin initial

```bash
pnpm db:push                  # crée les 11 tables
pnpm db:seed                  # crée l'admin local depuis ADMIN_INITIAL_*
```

### 6. Build et lancer

```bash
pnpm build
pnpm start                    # ou via systemd (voir plus bas)
```

---

## Configuration `.env`

```bash
# ─── PostgreSQL ─────────────────────────────────────────────────
DATABASE_URL="postgresql://aimatrix_user:CHANGEME@127.0.0.1:5432/aimatrixmanager?schema=public"

# ─── NextAuth ───────────────────────────────────────────────────
AUTH_SECRET=""                # openssl rand -base64 32
AUTH_TRUST_HOST="true"
NEXTAUTH_URL="https://ai.example.com"   # prod uniquement

# ─── Admin initial (utilisé par `pnpm db:seed` uniquement) ──────
ADMIN_INITIAL_EMAIL="admin@example.com"
ADMIN_INITIAL_PASSWORD="ChangeMeNow!"

# ─── Keycloak (vide = désactivé, fallback credentials) ──────────
KEYCLOAK_ISSUER="https://keycloak.example.com/realms/EXAMPLE"
KEYCLOAK_CLIENT_ID="aibotmanager"
KEYCLOAK_CLIENT_SECRET=""

# ─── Redis ──────────────────────────────────────────────────────
REDIS_URL="redis://127.0.0.1:6379"

# ─── Logs ───────────────────────────────────────────────────────
LOG_LEVEL="info"

# ─── Matrix / Synapse ───────────────────────────────────────────
MATRIX_HOMESERVER="http://127.0.0.1:8008"
MATRIX_SERVER_NAME="matrix.example.com"
SYNAPSE_ADMIN_TOKEN=""

# ─── Chiffrement secrets DB (AES-256-GCM, NE JAMAIS PERDRE) ─────
WS_TOKEN_ENCRYPTION_KEY=""    # openssl rand -base64 32

# ─── Anthropic ──────────────────────────────────────────────────
ANTHROPIC_API_KEY=""
```

> ⚠️ **`WS_TOKEN_ENCRYPTION_KEY`** chiffre les `wsToken` Moodle et les `matrixAccessToken` des agents. Si tu la perds, tous ces secrets stockés sont irrécupérables (à re-saisir manuellement). Sauvegarde-la dans un coffre-fort dès la mise en prod.

> Les **plateformes Moodle** (DISI, P11STN…) **ne sont pas dans `.env`** — elles se gèrent dans l'UI `/moodle`.

---

## Lancer en développement

```bash
pnpm dev                                  # http://localhost:3000
```

Hot-reload via Turbopack. Les changements de schéma Prisma nécessitent `pnpm db:push && pnpm exec prisma generate`.

### Test smoke (DB + Redis + Prisma)

```bash
pnpm exec tsx scripts/smoke-test.ts
```

### Test Moodle Web Services

```bash
pnpm exec tsx scripts/test-moodle.ts
pnpm exec tsx scripts/test-moodle-functions.ts   # liste les fonctions WS dispo
```

---

## Déploiement production (systemd)

### Service unit

`/etc/systemd/system/aimatrixmanager.service` :

```ini
[Unit]
Description=aibotmanager — gestion des agents IA Matrix
After=network.target

[Service]
User=pabn
Group=pabn
WorkingDirectory=/var/www/html/aimatrixmanager
Environment="NODE_ENV=production"
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
ExecStart=/usr/bin/pnpm start
Restart=always
RestartSec=10
StartLimitIntervalSec=60
StartLimitBurst=3
LimitNOFILE=50000
StandardOutput=append:/var/log/aimatrixmanager_output.log
StandardError=append:/var/log/aimatrixmanager_error.log

[Install]
WantedBy=multi-user.target
```

### Activation

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aimatrixmanager
sudo systemctl status aimatrixmanager
```

### Cycle de mise à jour

```bash
cd /var/www/html/aimatrixmanager
git pull                           # ou rsync
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm db:push                       # si le schéma a changé
pnpm build
sudo systemctl restart aimatrixmanager
sudo tail -f /var/log/aimatrixmanager_output.log
```

### Reverse proxy nginx (extrait)

```nginx
server {
    listen 443 ssl http2;
    server_name ai.example.com;

    ssl_certificate     /etc/letsencrypt/live/ai.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ai.example.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

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
5. Appel Claude avec le `systemPrompt`, `model`, `maxTokens`, `temperature` propres à l'agent
6. Réponse envoyée (avec partage de session Megolm si E2EE)
7. Insert dans `AuditLog` : tokens, latence, erreur éventuelle

**Cycle de vie côté UI** :

| Action | Conséquence côté Matrix |
|---|---|
| Création d'un agent (`/agents/new`) | Compte Matrix provisionné via Synapse Admin API + client login → access_token + device_id chiffrés en DB |
| Statut `ENABLED` | Sera lancé au prochain démarrage du bot Python |
| Assignation à une room (`/rooms/[id]`) | `joinUserToRoom` admin force le bot à rejoindre |
| Désassignation | Le bot quitte la room avec son propre token |
| Bouton « Régénérer token » | Reset password admin → client login → nouveau token + device |

**Le bot doit être redémarré** après modification de la liste des agents `ENABLED` (la lecture DB est faite uniquement au boot pour le moment) :

```bash
sudo docker restart bot-ia
```

Phase suivante envisagée : un signal SIGHUP ou un canal Redis pub/sub pour reconfigurer à chaud.

---

## Workflows

### Première mise en service (admin)

```
1. Login (Keycloak ou local)
2. /moodle → ajouter une plateforme (clé + URL + token WS)
   → cf. section Moodle — service Web Services pour les fonctions à activer
3. /moodle → bouton 🔄 → sync des cours dans MoodleCourse
4. /moodle/[id]/activities → bouton Synchroniser
   → importe les MoodleMatrixActivity + lie les Room ↔ MoodleCourse
5. /rooms → bouton « Synchroniser depuis Synapse » (découvre toutes les rooms)
6. /agents → créer un agent (slug, prompt, modèle) → ENABLED
7. /rooms/[id] → assigner l'agent + lier au cours Moodle si non auto-lié
8. /rooms/[id] → activer l'indexation RAG (Phase 11)
9. Redémarrer le bot Python : sudo docker restart bot-ia
10. Élève écrit `@<slug> bonjour ...` dans Element → l'agent répond
11. /audit → contrôle pédagogique des conversations
```

### Flow ENSEIGNANT (auto-service)

```
1. Admin promeut l'utilisateur ENSEIGNANT dans /users
2. L'ENSEIGNANT se connecte (Keycloak — son email doit matcher son compte Moodle)
3. /mes-cours → résolution auto via WS (cache 1h)
   → liste les cours où il est editingteacher/teacher
4. /agents/new → crée son propre agent IA (slug, prompt, modèle)
5. /rooms → voit uniquement les salons Moodle de ses cours
6. /rooms/[id] → assigne son agent au salon (sélecteur scopé à ses agents)
7. Le bot répond aux mentions dans le salon une fois redémarré
```

### Cycle de mise à jour code

```bash
cd /var/www/html/aimatrixmanager
git pull
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm db:push                     # si le schéma a changé
pnpm build
sudo systemctl restart aimatrixmanager
# Si bot Python touché :
cd /opt/matrix-synapse && sudo docker compose up -d --build bot-ia
```

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

Deux providers, pilotage hybride env + DB :

```
Cas de figure                                      Effet
─────────────────────────────────────────────────  ──────────────────────────────────────
KEYCLOAK_* vides dans .env                         Keycloak invisible (kill switch)
KEYCLOAK_* set + toggle DB ON  (Admin /settings)   Keycloak prioritaire + credentials fallback
KEYCLOAK_* set + toggle DB OFF                     Keycloak masqué + bloqué côté serveur
```

Le **rôle est toujours rechargé depuis la DB** au login (Keycloak ne peut pas dicter de rôle).

Premier login Keycloak → compte créé en DB avec rôle `AUDITOR` → un admin doit le promouvoir via `/users`.

### Changer le mot de passe d'un user local

```bash
# Interactif (saisie masquée)
pnpm user:password admin@example.com

# Via env (pas d'historique shell)
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='nouveau' pnpm user:password
```

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
| `pnpm db:seed` | Crée/met à jour l'admin initial |
| `pnpm user:password <email> [pwd]` | Reset password d'un user local |
| `pnpm exec tsx scripts/smoke-test.ts` | Vérifie DB + Redis + Prisma |
| `pnpm exec tsx scripts/test-moodle.ts` | Teste les WS Moodle (toutes plateformes actives) |
| `pnpm exec tsx scripts/test-moodle-functions.ts` | Liste les fonctions WS autorisées par le token |
| `pnpm exec tsx scripts/migrate-ws-tokens.ts` | Chiffre les tokens Moodle encore en clair |

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
- Le cache est de 1h dans `User.moodleUserMap` — pour forcer un refresh : `UPDATE "User" SET "lastMoodleSyncAt" = NULL WHERE email = '<email>';`

### Une activité mod_matrix créée côté Moodle n'apparaît pas dans `/moodle/[id]/activities`
- La synchro mod_matrix est manuelle : aller sur `/moodle/[id]/activities` → bouton **Synchroniser**.
- Le service WS doit avoir `mod_matrix_get_matrices_by_courses` (sinon `accessexception`).
- Si l'activité est en mode `target=element-url` (URL Element au lieu de room Matrix native), le `matrix_room_id` est vide côté Moodle → on fait un fallback fuzzy par nom de room. Si plusieurs candidats matchent, le lien est skip (logué en warn).

### Synapse `429 Too Many Requests` lors de la création d'une activité mod_matrix
- Le plugin invite tous les inscrits du cours d'un coup → dépasse les rate limits `rc_invites` par défaut. Augmenter dans `/etc/matrix-synapse/homeserver.yaml` :
  ```yaml
  rc_invites:
    per_room:  { per_second: 5, burst_count: 100 }
    per_user:  { per_second: 1, burst_count: 50 }
    per_issuer: { per_second: 5, burst_count: 100 }
  ```
  puis `sudo systemctl restart matrix-synapse`.

### Bouton "Se connecter avec Keycloak" absent
- `.env` a-t-il les 3 vars `KEYCLOAK_*` non vides ?
- Toggle DB activé ? Voir `/settings`.
- Le service a-t-il été redémarré après modif `.env` ?

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

© DITSI – UN-CHK – 2026 – Tous droits réservés
