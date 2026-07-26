# Guide de déploiement — AI Bot Manager

Ce document décrit le déploiement complet d'aibotmanager **étape par étape**,
depuis une machine Ubuntu vierge jusqu'au premier message d'un agent IA dans
un salon Matrix lié à un cours Moodle.

Pour une vue d'ensemble, l'architecture, le schéma de données et le
dépannage : voir [`README.md`](README.md).

---

## Sommaire

1. [Vue d'ensemble du déploiement](#vue-densemble-du-déploiement)
2. [Prérequis](#prérequis)
3. [Étape 1 — Préparer la machine](#étape-1--préparer-la-machine)
4. [Étape 2 — Postgres + pgvector](#étape-2--postgres--pgvector)
5. [Étape 3 — Synapse Matrix](#étape-3--synapse-matrix)
6. [Étape 4 — Keycloak](#étape-4--keycloak)
7. [Étape 5 — Moodle](#étape-5--moodle)
8. [Étape 6 — Ollama et Anthropic](#étape-6--ollama-et-anthropic)
9. [Étape 7 — Cloner et configurer aibotmanager](#étape-7--cloner-et-configurer-aibotmanager)
10. [Étape 8 — Service systemd](#étape-8--service-systemd)
11. [Étape 9 — nginx (app + Synapse)](#étape-9--nginx-app--synapse)
12. [Étape 10 — Bot Python (Docker)](#étape-10--bot-python-docker)
13. [Étape 11 — Premier login (bootstrap ADMIN)](#étape-11--premier-login-bootstrap-admin)
14. [Étape 12 — Ajouter une plateforme Moodle](#étape-12--ajouter-une-plateforme-moodle)
15. [Étape 13 — Créer un agent IA et tester](#étape-13--créer-un-agent-ia-et-tester)
16. [Étape 14 — Activer l'indexation RAG](#étape-14--activer-lindexation-rag)
17. [Checklist post-déploiement](#checklist-post-déploiement)
18. [Maintenance](#maintenance)

---

## Vue d'ensemble du déploiement

```
┌───────────────────────────────────────────────────────────────┐
│  Serveur Ubuntu 22.04+                                        │
│                                                               │
│  ┌─────────────────┐   ┌──────────────────┐                   │
│  │ Next.js (3000)  │←──│ Redis (6379)     │                   │
│  │ aibotmanager    │   │ + BullMQ queue   │                   │
│  └────────┬────────┘   └──────────────────┘                   │
│           │                                                   │
│           ▼                                                   │
│  ┌──────────────────┐   ┌──────────────────┐                  │
│  │ Postgres (5432)  │   │ Synapse (8008)   │                  │
│  │ + pgvector       │   │ + Element Web    │                  │
│  └──────────────────┘   └──────────────────┘                  │
│           ▲                       ▲                           │
│           │                       │                           │
│  ┌────────┴───────────────────────┴───┐                       │
│  │ Bot Python (Docker, matrix-nio)    │                       │
│  │ - N runners async, un par agent    │                       │
│  └────────────────────────────────────┘                       │
└───────────────────────────────────────────────────────────────┘

Services externes (sur d'autres machines / SaaS) :
  - Keycloak SSO        (https://senid.unchk.sn)
  - Moodle(s) WS        (https://disidev.unchk.sn, ...)
  - Ollama gateway      (https://fromager.unchk.sn) — embeddings + LLM
  - Anthropic API       (https://api.anthropic.com) — LLM principal
```

Compter ~2h pour un premier déploiement complet si toutes les prérequis
externes sont prêtes ; 4-6h sinon.

---

## Prérequis

### Côté machine cible
- **Ubuntu 22.04 LTS ou +**, accès root (`sudo`)
- **Domaine public** pointé vers le serveur (ex. `aibotmanager.unchk.sn`)
- **Certificat TLS** valide pour ce domaine
- **Ports ouverts** : 80, 443 (entrant) + sortants vers Keycloak, Moodle, Ollama, Anthropic

### Services externes prêts
| Service | Ce qu'il faut récupérer |
|---|---|
| **Synapse Matrix** | URL homeserver (interne ou public), `server_name`, access_token admin |
| **Keycloak** | URL realm, possibilité de créer un client OIDC, droit d'ajouter un mapper de claim custom |
| **Moodle(s)** | URL, admin droits, un compte service avec accès WS |
| **Ollama** | URL endpoint, clé API (compat OpenAI), modèle `nomic-embed-text` déployé |
| **Anthropic** | Clé API avec budget |

> Tu peux déployer plusieurs Moodles plus tard via l'UI — un seul suffit
> pour le premier test.

---

## Étape 1 — Préparer la machine

### 1.1 Mise à jour système

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential ca-certificates gnupg lsb-release
```

### 1.2 Node.js 22 LTS via nvm

```bash
# Installer nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc

# Installer Node 22
nvm install 22
nvm use 22
nvm alias default 22

# Vérifier
node -v   # → v22.x.x
```

### 1.3 pnpm 10+

```bash
sudo npm install -g --prefix=/usr pnpm
pnpm -v   # → 10.33+
```

> Le préfixe `/usr` est important pour que `pnpm` soit dans le `PATH` du
> service systemd plus loin (qui tourne en environnement minimal).

### 1.4 Docker + Docker Compose

```bash
# Installer Docker via le repo officiel
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

sudo docker --version          # → Docker version 24+
sudo docker compose version    # → v2.x+
```

### 1.5 Redis natif 6+

```bash
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
redis-cli ping   # → PONG
```

### 1.6 nginx

```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

### 1.7 Déposer le certificat TLS

```bash
sudo mkdir -p /etc/nginx/ssl
sudo cp /chemin/vers/unchk.sn_cert.pem /etc/nginx/ssl/
sudo cp /chemin/vers/star_unchk.sn.key /etc/nginx/ssl/
sudo chmod 600 /etc/nginx/ssl/*.key
```

---

## Étape 2 — Postgres + pgvector

aibotmanager partage la même instance Postgres que Synapse, en utilisant
l'image `pgvector/pgvector:pg15` (compatible binaire avec `postgres:15`).

### 2.1 Créer le compose pour Postgres + Synapse

Si tu n'as pas encore de compose Matrix, crée
`/opt/matrix-synapse/docker-compose.yml` avec au minimum :

```yaml
x-logging: &default-logging
  driver: json-file
  options:
    max-size: "50m"
    max-file: "3"

services:
  postgres:
    image: pgvector/pgvector:pg15
    container_name: synapse-postgres
    restart: unless-stopped
    logging: *default-logging
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: synapsedb
      POSTGRES_USER: synapseuser
      POSTGRES_PASSWORD: <MOT_DE_PASSE_FORT>
      POSTGRES_INITDB_ARGS: "--encoding=UTF-8 --lc-collate=C --lc-ctype=C"
    volumes:
      - ./postgres/data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-q", "-d", "synapsedb", "-U", "synapseuser"]
      interval: 10s
      timeout: 5s
      retries: 10
```

```bash
cd /opt/matrix-synapse
sudo docker compose up -d postgres
sudo docker compose ps   # postgres = healthy
```

### 2.2 Vérifier que l'extension pgvector est disponible

```bash
sudo docker exec synapse-postgres psql -U synapseuser -d postgres \
  -c "SELECT * FROM pg_available_extensions WHERE name='vector';"
```

Doit retourner une ligne avec la version `0.8+`.

### 2.3 Créer la DB et le user dédiés à aibotmanager

```bash
DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
echo "Password DB aibotmanager : $DB_PASS"   # à reporter dans .env plus tard

sudo docker exec synapse-postgres psql -U synapseuser -d postgres <<EOF
CREATE USER aimatrix_user WITH PASSWORD '$DB_PASS';
CREATE DATABASE aimatrixmanager OWNER aimatrix_user;
EOF

sudo docker exec synapse-postgres psql -U synapseuser -d aimatrixmanager <<EOF
CREATE EXTENSION vector;
GRANT ALL PRIVILEGES ON SCHEMA public TO aimatrix_user;
EOF
```

---

## Étape 3 — Synapse Matrix

Si Synapse est déjà déployé : note l'URL interne (typiquement
`http://127.0.0.1:8008`) et génère un **access_token admin**.

Si tu pars de zéro : déploie Synapse en suivant la doc officielle, puis
récupère un token admin :

```bash
# Créer le user admin (si pas déjà fait)
sudo docker exec -it synapse register_new_matrix_user \
  -c /data/homeserver.yaml -a -u admin-ditsi -p '<PASSWORD>' http://localhost:8008

# Récupérer un access_token via /login
curl -X POST http://127.0.0.1:8008/_matrix/client/v3/login \
  -H "Content-Type: application/json" \
  -d '{
    "type": "m.login.password",
    "identifier": {"type": "m.id.user", "user": "@admin-ditsi"},
    "password": "<PASSWORD>",
    "device_id": "AIBOTMANAGER_ADMIN",
    "initial_device_display_name": "aibotmanager admin tool"
  }' | jq -r .access_token
# → syt_xxxxxxxxxx — à reporter dans SYNAPSE_ADMIN_TOKEN
```

> Le token a une durée illimitée par défaut. Pour le révoquer plus tard,
> `POST /_matrix/client/v3/logout` avec ce token.

---

## Étape 4 — Keycloak

### 4.1 Créer le client OIDC

Dans la console Keycloak, sur le realm cible (ex. `UNCHK`) :

> **Clients** → **Create client**

| Champ | Valeur |
|---|---|
| Client type | `OpenID Connect` |
| Client ID | `aibotmanager` |
| Client authentication | `ON` |
| Standard flow | ✅ |
| Direct access grants | ❌ (pas utilisé) |
| Valid redirect URIs | `https://aibotmanager.unchk.sn/api/auth/callback/keycloak` |
| Web origins | `https://aibotmanager.unchk.sn` |

Onglet **Credentials** → noter le **Client secret** (à reporter dans
`KEYCLOAK_CLIENT_SECRET`).

### 4.2 Activer le claim `affiliation` (filtre d'accès)

aibotmanager bloque tous les comptes sauf ceux ayant `affiliation=Personnel`.
Pour que ce claim arrive dans l'`id_token`, ajouter un mapper :

> **Clients** → `aibotmanager` → **Client scopes** → `aibotmanager-dedicated`
> → **Add mapper** → **By configuration** → **User Attribute**

| Champ | Valeur |
|---|---|
| Name | `affiliation` |
| User Attribute | `affiliation` |
| Token Claim Name | `affiliation` |
| Claim JSON Type | `String` |
| Add to ID token | ✅ |
| Add to access token | ✅ (optionnel) |
| Add to userinfo | ✅ |

Vérifier ensuite que les utilisateurs ont bien l'attribut `affiliation`
défini avec une des valeurs `Personnel`, `Etudiant`, `Tuteur`, etc.
(souvent peuplé via LDAP ou un attribut user manuel).

### 4.3 Vérifier la config

À la fin de l'étape 11 (premier login), tu pourras valider que le claim
arrive correctement en consultant `AuthAuditLog` côté DB :

```sql
SELECT type, email, reason FROM "AuthAuditLog"
ORDER BY "createdAt" DESC LIMIT 5;
```

Une ligne `type=SIGN_IN` = OK. Une ligne `type=ACCESS_DENIED` avec
`reason=affiliation=null` = le mapper n'est pas pris en compte → revoir
l'étape 4.2.

---

## Étape 5 — Moodle

aibotmanager interroge chaque Moodle via un **service externe dédié**.

### 5.1 Créer le service externe

Dans Moodle :

> **Site administration → Server → Web services → External services → Add**

| Option | Valeur |
|---|---|
| Name | `aibotmanager` |
| Enabled | ✅ |
| Authorized users only | ✅ |
| Can download files | ✅ (requis pour le RAG, sinon `accessexception`) |

### 5.2 Ajouter les fonctions WS au service

Onglet **Functions** :

| Fonction | Obligatoire ? |
|---|:---:|
| `core_course_get_courses_by_field` | ✅ |
| `core_course_get_contents` | ✅ (sync RAG) |
| `core_user_get_users_by_field` | ✅ (rôle ENSEIGNANT) |
| `core_enrol_get_users_courses` | ✅ (rôle ENSEIGNANT) |
| `core_enrol_get_enrolled_users` | ✅ (rôle ENSEIGNANT) |
| `mod_matrix_get_matrices_by_courses` | ✅ (si plugin mod_matrix utilisé) |

### 5.3 Compte service et token

Crée un user Moodle de service (rôle `Manager` au niveau site, pas
`Admin`) puis :

> **Manage tokens** → **Create token** → service `aibotmanager`, user `<le compte service>`

Note le token : il sera chiffré AES-256-GCM en DB par aibotmanager. Il n'a
pas besoin d'être communiqué autrement.

⚠️ Le rôle `Manager` doit être assigné au **contexte système**, pas à des
cours individuels. Un compte aux droits limités ne voit qu'une partie des
cours : `mod_matrix_get_matrices_by_courses` retourne alors des
`warnings: "No access rights in course context"` et les activités des
cours concernés sont invisibles.

### 5.3 bis — Réglage `showuseridentity` (indispensable)

> **Site administration → Users → Permissions → User policies → Show user identity**
> → cocher **Email address**

Sans ce réglage, `core_user_get_users_by_field` avec `field=email` retourne
**un tableau vide** au lieu d'une erreur, et le champ `email` disparaît des
objets utilisateur retournés. Conséquence : `resolveTeacherCourseIds` ne
peut pas résoudre le compte Moodle des enseignants, la plateforme n'entre
jamais dans `User.moodleUserMap`, et `/mes-cours` reste vide **sans aucun
message d'erreur**.

Vérification :

```bash
curl -s "<BASE_URL>/webservice/rest/server.php?wstoken=<TOKEN>\
&wsfunction=core_user_get_users_by_field&moodlewsrestformat=json\
&field=email&values[0]=<EMAIL_D_UN_ENSEIGNANT>"
# → []      : réglage manquant
# → [{...}] : OK
```

### 5.4 Plugin mod_matrix (Famedly)

Pour que les salons mod_matrix créés depuis Moodle soient associés
automatiquement aux cours côté aibotmanager :

```bash
# Sur le serveur Moodle :
cd /var/www/html/<moodle>/mod
git clone https://github.com/element-hq/moodle-mod_matrix matrix
chown -R www-data:www-data matrix
```

Puis via l'UI Moodle : **Site administration → Notifications** pour finir
l'install.

---

## Étape 6 — Ollama et Anthropic

### 6.1 Ollama (embeddings + LLM optionnel)

Vérifier que ton endpoint Ollama (compat OpenAI) est joignable et a
`nomic-embed-text` chargé :

```bash
curl -s -H "Authorization: Bearer <OLLAMA_API_KEY>" \
  https://fromager.unchk.sn/v1/models | jq -r '.data[].id'
# Doit lister au moins : nomic-embed-text
```

Pour ajouter le modèle (côté serveur Ollama) :

```bash
ollama pull nomic-embed-text
```

### 6.2 Anthropic

Récupérer une clé API depuis https://console.anthropic.com → **API Keys**
et vérifier le budget alloué.

```bash
curl -s -H "x-api-key: <ANTHROPIC_API_KEY>" \
     -H "anthropic-version: 2023-06-01" \
     https://api.anthropic.com/v1/models | jq '.data[0]'
```

---

## Étape 7 — Cloner et configurer aibotmanager

### 7.1 Cloner le code

```bash
sudo mkdir -p /var/www/html/aimatrixmanager
sudo chown -R $USER:$USER /var/www/html/aimatrixmanager
cd /var/www/html/aimatrixmanager
git clone <url-du-repo> .   # ou rsync depuis un autre serveur
```

### 7.2 Installer les dépendances

```bash
pnpm install --frozen-lockfile
```

### 7.3 Configurer `.env`

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Remplir **toutes** les variables :

```bash
# ─── PostgreSQL ──────────────────────────────────────────────────
DATABASE_URL="postgresql://aimatrix_user:<DB_PASS>@127.0.0.1:5432/aimatrixmanager?schema=public"

# ─── NextAuth ────────────────────────────────────────────────────
AUTH_SECRET="<openssl rand -base64 32>"
AUTH_TRUST_HOST="true"
NEXTAUTH_URL="https://aibotmanager.unchk.sn"

# ─── Keycloak (provider unique) ──────────────────────────────────
KEYCLOAK_ISSUER="https://senid.unchk.sn/realms/UNCHK"
KEYCLOAK_CLIENT_ID="aibotmanager"
KEYCLOAK_CLIENT_SECRET="<noté à l'étape 4.1>"

# ─── Redis ───────────────────────────────────────────────────────
REDIS_URL="redis://127.0.0.1:6379"

# ─── Logs ────────────────────────────────────────────────────────
LOG_LEVEL="info"

# ─── Matrix / Synapse ────────────────────────────────────────────
MATRIX_HOMESERVER="http://127.0.0.1:8008"
MATRIX_SERVER_NAME="formation1-matrix.unchk.sn"
SYNAPSE_ADMIN_TOKEN="<noté à l'étape 3>"

# ─── Chiffrement secrets DB (AES-256-GCM, NE JAMAIS PERDRE) ──────
WS_TOKEN_ENCRYPTION_KEY="<openssl rand -base64 32>"

# ─── Anthropic ───────────────────────────────────────────────────
ANTHROPIC_API_KEY="<noté à l'étape 6.2>"

# ─── Ollama (embeddings + LLM secondaire) ────────────────────────
OLLAMA_BASE_URL="https://fromager.unchk.sn"
OLLAMA_API_KEY="<noté à l'étape 6.1>"
OLLAMA_EMBED_MODEL="nomic-embed-text"
```

> ⚠️ **`WS_TOKEN_ENCRYPTION_KEY` doit être sauvegardée dans un coffre-fort**.
> Si tu la perds, tous les tokens Moodle et tous les `matrixAccessToken`
> des agents sont irrécupérables et il faudra les re-saisir manuellement.

### 7.4 Pousser le schéma en DB

```bash
pnpm db:push   # crée les 17 tables
```

### 7.5 Build de production

```bash
pnpm build
```

Vérifier qu'il n'y a aucune erreur. Le build doit lister les routes :

```
├ ƒ /agents
├ ƒ /agents/[id]
├ ƒ /agents/[id]/edit
├ ƒ /agents/new
├ ƒ /api/auth/[...nextauth]
├ ƒ /api/auth/rejection-logout
├ ƒ /api/auth/sso-keycloak
├ ƒ /dashboard
├ ○ /access-denied
├ ○ /help
├ ƒ /login
├ ƒ /mes-cours
├ ƒ /moodle
├ ƒ /moodle/[id]/activities
├ ƒ /moodle/[id]/edit
├ ƒ /moodle/new
├ ƒ /rooms
├ ƒ /rooms/[id]
├ ƒ /settings
└ ƒ /users
```

---

## Étape 8 — Service systemd

Créer `/etc/systemd/system/aimatrixmanager.service` :

```ini
[Unit]
Description=aibotmanager — gestion des agents IA Matrix
After=network.target postgres.service redis-server.service

[Service]
Type=simple
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

> Remplacer `User=pabn` et `Group=pabn` par l'utilisateur qui possède le
> répertoire (celui qui a fait `pnpm install`).

Activer :

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aimatrixmanager
sudo systemctl status aimatrixmanager   # → Active: running
sudo tail -f /var/log/aimatrixmanager_output.log
```

Test de santé local :

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3000/login
# → HTTP 307 (redirect vers Keycloak)
```

---

## Étape 9 — nginx (app + Synapse)

### 9.1 Vhost de l'application

Créer `/etc/nginx/sites-available/aibotmanager.conf` :

```nginx
server {
    listen 80;
    server_name aibotmanager.unchk.sn;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name aibotmanager.unchk.sn;

    ssl_certificate     /etc/nginx/ssl/unchk.sn_cert.pem;
    ssl_certificate_key /etc/nginx/ssl/star_unchk.sn.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        # Sessions Server-Sent Events / streaming : pas de timeout court
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/aibotmanager.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 9.2 Vhost Synapse (avec admin restreint par IP)

Créer `/etc/nginx/sites-available/synapse-matrix.conf` :

```nginx
server {
    listen 80;
    server_name formation1-matrix.unchk.sn;
    return 301 https://$host$request_uri;
}

server {
    server_name formation1-matrix.unchk.sn;

    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    listen 8448 ssl;       # federation
    listen [::]:8448 ssl;

    ssl_certificate     /etc/nginx/ssl/unchk.sn_cert.pem;
    ssl_certificate_key /etc/nginx/ssl/star_unchk.sn.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # ========================================================
    # Synapse Admin API — restreint par IP (sécurité critique)
    # ========================================================
    # Doit être AVANT la location générique (premier match gagne).
    location ~ ^/_synapse/admin {
        allow 127.0.0.1;
        allow 10.149.0.0/16;       # LAN UN-CHK
        allow 102.36.136.0/24;     # IP publique DITSI
        allow 102.36.138.0/24;     # IP publique DITSI bis
        deny all;
        proxy_pass http://127.0.0.1:8008;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 250M;
        proxy_read_timeout 600s;
    }

    # ========================================================
    # API client + SSO (publique)
    # ========================================================
    location ~ ^(/_matrix|/_synapse/client) {
        proxy_pass http://127.0.0.1:8008;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 250M;
        proxy_read_timeout 600s;
    }

    # ========================================================
    # Délégation .well-known
    # ========================================================
    location /.well-known/matrix/client {
        default_type application/json;
        add_header Access-Control-Allow-Origin "*" always;
        return 200 '{"m.homeserver": {"base_url": "https://formation1-matrix.unchk.sn"}}';
    }
    location /.well-known/matrix/server {
        default_type application/json;
        add_header Access-Control-Allow-Origin "*" always;
        return 200 '{"m.server": "formation1-matrix.unchk.sn:443"}';
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/synapse-matrix.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 9.3 Vérifier que tout répond

```bash
# App publique
curl -sI https://aibotmanager.unchk.sn/help | head -3
# → HTTP/1.1 200 OK

# Synapse client (publique)
curl -s https://formation1-matrix.unchk.sn/_matrix/client/versions | head -c 100
# → {"versions":[...]}

# Synapse admin (externe → doit être 403)
curl -sI https://formation1-matrix.unchk.sn/_synapse/admin/v1/server_version | head -3
# → HTTP/1.1 403 Forbidden
```

---

## Étape 10 — Bot Python (Docker)

Le bot tourne dans un conteneur Docker séparé qui partage la même DB
Postgres.

### 10.1 Ajouter le service au compose

Éditer `/opt/matrix-synapse/docker-compose.yml` pour ajouter :

```yaml
services:
  # ... postgres et autres services existants ...

  bot-ia:
    build: /var/www/html/aimatrixmanager/bot
    container_name: bot-ia
    restart: always
    network_mode: host
    logging: *default-logging
    env_file: .env       # voir 10.2 ci-dessous
    volumes:
      - bot_store:/app/store
    depends_on:
      - postgres

volumes:
  bot_store:
```

### 10.2 Variables d'environnement du bot

Le bot lit `/opt/matrix-synapse/.env`. Y mettre **au minimum** :

```bash
DATABASE_URL=postgresql://aimatrix_user:<DB_PASS>@127.0.0.1:5432/aimatrixmanager
MATRIX_HOMESERVER=http://127.0.0.1:8008
SYNAPSE_ADMIN_TOKEN=<noté à l'étape 3>
WS_TOKEN_ENCRYPTION_KEY=<MÊME VALEUR que celle d'aibotmanager>
ANTHROPIC_API_KEY=<noté à l'étape 6.2>
OLLAMA_BASE_URL=https://fromager.unchk.sn
OLLAMA_API_KEY=<noté à l'étape 6.1>
OLLAMA_EMBED_MODEL=nomic-embed-text
LOG_LEVEL=INFO
RECONCILE_INTERVAL=60   # secondes
```

> ⚠️ `WS_TOKEN_ENCRYPTION_KEY` **doit être identique** à celle de
> `/var/www/html/aimatrixmanager/.env`. Sinon le bot ne peut pas déchiffrer
> les `matrixAccessToken` des agents stockés en DB par l'app.

### 10.3 Build et démarrage

```bash
cd /opt/matrix-synapse
sudo docker compose up -d --build bot-ia

# Vérifier
sudo docker ps --filter "name=bot-ia"   # → Up healthy
sudo docker logs --tail 50 bot-ia
```

Au démarrage, le bot lit les agents `ENABLED` et lance un runner par
agent. Si aucun agent n'existe encore (cas du premier déploiement), le
bot tourne en attendant.

---

## Étape 11 — Premier login (bootstrap ADMIN)

Ouvre `https://aibotmanager.unchk.sn/login` dans un navigateur.

1. La page redirige immédiatement vers Keycloak (307 → SSO).
2. Authentifie-toi avec un compte UN-CHK ayant `affiliation=Personnel`.
3. À la première connexion, le compte est créé en DB et **promu ADMIN
   automatiquement** (cf. `events.createUser` dans `src/auth.ts`).
4. Tu arrives sur `/dashboard`.

### Vérifications

```bash
# Un user créé, rôle ADMIN
sudo docker exec synapse-postgres psql -U aimatrix_user -d aimatrixmanager \
  -c "SELECT email, role, \"lastLoginAt\", \"lastLoginIp\" FROM \"User\";"

# Un audit log SIGN_IN
sudo docker exec synapse-postgres psql -U aimatrix_user -d aimatrixmanager \
  -c "SELECT type, email, \"ipAddress\" FROM \"AuthAuditLog\" ORDER BY \"createdAt\" DESC LIMIT 3;"
```

Sur le dashboard `/dashboard`, la carte « État des services » doit
afficher :
- ✅ PostgreSQL
- ✅ Redis
- ✅ Synapse Matrix
- ⚠️ Bot multi-agents (aucun agent ENABLED — normal)
- ✅ Ollama (`X modèle(s) · Y ms`)
- ⚠️ Plateformes Moodle (aucune active — normal)

### Promouvoir d'autres ADMIN

> **`/users`** → sur chaque user → bouton « Changer le rôle ».

---

## Étape 12 — Ajouter une plateforme Moodle

> **`/moodle`** → **« Nouvelle plateforme »**

| Champ | Valeur |
|---|---|
| Clé | `DISIDEV` (slug court, lettres) |
| Nom | `DISIDEV` |
| URL de base | `https://disidev.unchk.sn` |
| Token WS | `<token noté à l'étape 5.3>` |
| Activé | ✅ |

Le token est chiffré AES-256-GCM en DB. Tu ne le verras plus jamais en
clair côté UI.

### Sync initial

1. **`/moodle`** → bouton **🔄** : sync des cours (`MoodleCourse`)
2. **`/moodle/<id>/activities`** → bouton **Synchroniser** : importe les
   activités `mod_matrix` + lie les Rooms aux cours
3. **`/rooms`** → bouton **« Synchroniser depuis Synapse »** : découvre
   toutes les rooms Matrix

---

## Étape 13 — Créer un agent IA et tester

> **`/agents`** → **« Créer un agent »**

| Champ | Exemple |
|---|---|
| Slug | `assistant-math` |
| Nom | `Assistant Math L1` |
| Description | `Bot d'aide aux exercices de mathématiques de L1` |
| Provider | `ANTHROPIC` |
| Modèle | `claude-sonnet-4-6` |
| Max tokens | `2000` |
| Température | `0.3` |
| System prompt | `Tu es un tuteur de mathématiques bienveillant…` |

Au submit :
- Un compte Matrix `@assistant-math:formation1-matrix.unchk.sn` est
  provisionné via Synapse Admin
- Un access_token client est généré et chiffré en DB
- Le bot Python détecte le nouvel agent au prochain tick reconcile
  (toutes les 60s) et lance un runner

### Affecter à un salon de test

> **`/rooms`** → choisir un salon → **« Affecter un agent »** → `@assistant-math`

### Test conversation

1. Dans Element, ouvre une **DM** avec `@assistant-math:formation1-matrix.unchk.sn`
2. Écris « Bonjour, qui es-tu ? »
3. L'agent doit répondre en streaming (placeholder pulsé puis réponse)

Si pas de réponse :

```bash
sudo docker logs --tail 100 bot-ia | grep -E "assistant-math|prêt"
```

---

## Étape 14 — Activer l'indexation RAG

Pour qu'un agent puisse répondre avec le contexte d'un cours Moodle :

1. **`/rooms/<id>`** où le salon est lié à un cours Moodle
2. Carte **« Indexation RAG du cours »** → toggle **« RAG actif sur ce cours »**
3. Bouton **« Réindexer le cours »** → un job BullMQ tourne en arrière-plan
4. Une barre de progression apparaît, le bot poll toutes les 2s
5. À la fin : `N chunks générés · M embeddings calculés · K modèle(s)`

Pendant l'indexation :
- Le sync structurel récupère les sections + ressources du cours
- Les PDF/DOCX/HTML sont téléchargés et extraits
- Le texte est chunké (~1000 chars, overlap 150)
- Chaque chunk est embeddé via `nomic-embed-text` (concurrency=1 pour ne
  pas saturer la GPU fromager)
- Les vecteurs sont stockés en `MoodleResourceChunk.embedding` avec un
  index HNSW pgvector cosinus

Une fois indexé, l'agent assigné au salon mention-répondra avec le
contexte du cours injecté (en mode tool-call pour Anthropic, en naïf top-K
pour Ollama).

---

## Checklist post-déploiement

À cocher avant de considérer le déploiement terminé :

### Sécurité
- [ ] `.env` à `chmod 600`, dans `.gitignore`
- [ ] `WS_TOKEN_ENCRYPTION_KEY` sauvegardée dans un coffre-fort
- [ ] `/_synapse/admin` restreint par IP côté nginx (cf. 9.2)
- [ ] `SYNAPSE_ADMIN_TOKEN` non partagé en clair (chat, screenshots, Git)
- [ ] Pas de port 8008 ou 5432 exposé sur Internet (vérifier `iptables -L`)

### Fonctionnel
- [ ] `/login` redirige vers Keycloak
- [ ] Premier user créé = ADMIN
- [ ] User non-Personnel → page `/access-denied`
- [ ] `/dashboard` affiche tous les services ✅
- [ ] Agent répond en DM
- [ ] Agent répond à une mention dans un salon
- [ ] Indexation RAG aboutit sans erreur

### Opérationnel
- [ ] `systemctl is-enabled aimatrixmanager` → enabled
- [ ] `docker compose ps` → tous services UP healthy
- [ ] Backup Postgres planifié (cron `pg_dump` quotidien)
- [ ] Logs Docker cappés (`max-size: 50m, max-file: 3`)
- [ ] Logs systemd cappés (`logrotate /var/log/aimatrixmanager_*.log`)
- [ ] Monitoring : qui alerte si `/dashboard` montre rouge ?

---

## Maintenance

### Mise à jour du code

```bash
cd /var/www/html/aimatrixmanager
git pull
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm db:push                     # si le schéma a changé
pnpm build
sudo systemctl restart aimatrixmanager

# Uniquement si le code Python du bot a changé :
cd /opt/matrix-synapse && sudo docker compose up -d --build bot-ia
```

### Rotation des secrets

| Secret | Procédure |
|---|---|
| `SYNAPSE_ADMIN_TOKEN` | Régénérer via `/login`, MAJ `.env` (× 2), `systemctl restart aimatrixmanager` + `docker compose restart bot-ia`, révoquer l'ancien (`POST /_matrix/client/v3/logout`) |
| `KEYCLOAK_CLIENT_SECRET` | Régénérer dans Keycloak → onglet Credentials, MAJ `.env`, `systemctl restart aimatrixmanager` |
| Token WS Moodle | Régénérer dans Moodle, MAJ via UI `/moodle/<id>/edit` (chiffré côté serveur) |
| `matrixAccessToken` d'un agent | UI **`/agents`** → bouton **« Régénérer token »** |

### Backup Postgres

```bash
# Cron quotidien à 3h du matin
sudo crontab -e
0 3 * * * sudo docker exec synapse-postgres pg_dump -U aimatrix_user aimatrixmanager | \
  gzip > /var/backups/aimatrix-$(date +\%Y\%m\%d).sql.gz

# Rotation 30 jours
0 4 * * * find /var/backups -name "aimatrix-*.sql.gz" -mtime +30 -delete
```

### Logs

```bash
# App Next.js
sudo tail -f /var/log/aimatrixmanager_output.log

# Bot Python
sudo docker logs -f --tail 100 bot-ia

# Synapse Matrix
sudo docker logs -f --tail 100 synapse
```

Pour le dépannage des cas usuels (token Moodle invalide, RAG bloqué,
`/mes-cours` vide, bot kické, etc.) → voir le [README](README.md), section
**Dépannage**.
