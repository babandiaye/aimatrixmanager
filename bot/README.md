# aibotmanager — runtime bot Python

Runtime multi-agents qui anime les bots Matrix configurés dans aibotmanager.
Chaque agent `ENABLED` en DB devient un client matrix-nio actif.

## Rôle

Ce binaire est le **complément exécutable** d'aibotmanager (Next.js) :

```
┌────────────────────────┐                ┌─────────────────────────┐
│  aibotmanager (UI)     │   PostgreSQL   │  bot Python (ce dossier)│
│  Next.js + Prisma      │ ◀────────────▶ │  matrix-nio + asyncpg   │
│  CRUD agents/rooms/... │                │  N agents en parallèle  │
└────────────────────────┘                └────────────┬────────────┘
                                                       │
                                                       ▼
                                            ┌──────────────────┐
                                            │  Synapse Matrix  │
                                            └──────────────────┘
```

L'UI Next.js gère la **configuration** (provider, prompt, modèle, assignations).
Le bot Python lit cette configuration et **fait tourner** les agents.

## Architecture du code

| Fichier | Rôle |
|---|---|
| `main.py` | Orchestrateur : `AgentRunner`, reconcile loop, asyncio.gather |
| `db.py` | Pool asyncpg, requêtes (agents, assignments, audit log, heartbeat) |
| `llm.py` | Dispatcher provider (Anthropic SDK / Ollama via OpenAI-compat) |
| `crypto_utils.py` | AES-256-GCM mirror de `src/lib/crypto.ts` (déchiffre `matrixAccessToken`, `wsToken`) |
| `Dockerfile` | Image Python 3.10 + libolm pour matrix-nio |
| `requirements.txt` | matrix-nio[e2e], anthropic, asyncpg, cryptography, httpx |

## Cycle de vie d'un agent (runtime)

```
[bot start]
   ↓
SELECT * FROM "Agent" WHERE status='ENABLED'
   ↓
Pour chaque agent : spawn AgentRunner.run() (asyncio.Task)
   ↓
   ├── matrix-nio AsyncClient (un par agent, store /app/store/<slug>/)
   ├── Restore_login(access_token, device_id)  ← déchiffré au runtime
   ├── Sync /sync_forever — reçoit RoomMessageText + MegolmEvent
   ├── À chaque message :
   │     ├── Vérifie RoomAgent enabled pour ce salon
   │     ├── Détecte mention (@slug, MXID, displayname)
   │     ├── Strip mention du body
   │     ├── llm.call(agent, history) → texte + tokens
   │     ├── Envoie réponse (E2EE si room chiffrée)
   │     └── Insert AuditLog (tokens, latence)
   ├── keys_loop (toutes les 5min — upload OTK + query devices)
   └── heartbeat_loop (toutes les 30s — UPDATE Agent.lastHeartbeatAt = NOW())

reconcile_loop (toutes les 60s) :
   ├── DISABLE/DELETE → cancel runner, close client
   └── ENABLE nouveau → spawn AgentRunner
```

## Variables d'environnement (héritées de `/opt/matrix-synapse/.env`)

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Connexion Postgres (lue via asyncpg) |
| `WS_TOKEN_ENCRYPTION_KEY` | Clé AES pour déchiffrer les tokens Matrix |
| `MATRIX_HOMESERVER` | Endpoint Synapse (`http://127.0.0.1:8008` typiquement) |
| `ANTHROPIC_API_KEY` | Optionnel — provider Claude |
| `OLLAMA_BASE_URL` | Optionnel — provider Ollama souverain |
| `OLLAMA_API_KEY` | Optionnel — Bearer token Ollama |
| `STORE_PATH` | `/app/store` — racine pour les stores olm (un sous-dossier par agent) |
| `LOG_LEVEL` | `INFO` par défaut |
| `MAX_HISTORY` | Nombre de messages conservés par room (défaut 20) |
| `RECONCILE_INTERVAL` | Période du reconcile loop (défaut 60s) |

## Build et exécution

Le bot tourne dans un conteneur Docker, géré par `/opt/matrix-synapse/docker-compose.yml` :

```yaml
bot-ia:
  build: /var/www/html/aimatrixmanager/bot
  container_name: bot-ia
  restart: always
  network_mode: host
  env_file: /opt/matrix-synapse/.env
  volumes:
    - bot_store:/app/store
  depends_on:
    - postgres
```

### Cycle de mise à jour

```bash
# Après modification du code dans bot/ :
cd /opt/matrix-synapse
sudo docker compose up -d --build bot-ia

# Voir les logs
sudo docker logs -f bot-ia
```

### Redémarrage NON requis pour…

Grâce au `reconcile_loop` (60s) et au `heartbeat_loop` :
- Création / désactivation / suppression d'un agent → pris en compte automatiquement
- Création / désaffectation d'une assignation room ↔ agent → pris en compte automatiquement (lookup à chaque message)

### Redémarrage requis pour…

- Modification du **prompt système, modèle, max_tokens, temperature** d'un agent existant (caché en mémoire au boot du runner)
- Modification des variables d'env

## E2EE — Notes

- Chaque agent a son propre **device** Matrix (créé via `client_login` lors de la création de l'agent côté UI)
- Store olm persistant dans `/app/store/<slug>/` — **ne jamais supprimer** sinon les clés Megolm sont perdues et l'agent ne peut plus déchiffrer les rooms historiques
- `ignore_unverified_devices=True` partout → l'agent tolère les clients sans cross-signing
- Pour rotation du token : utiliser le bouton « Régénérer token » dans l'UI agents (génère password + relogin → nouveau access_token + device_id)

## Sécurité — secrets manipulés

| Secret | Source | Manipulation |
|---|---|---|
| `Agent.matrixAccessToken` | DB (chiffré) | déchiffré uniquement en RAM par le runner |
| `MoodlePlatform.wsToken` | DB (chiffré) | non utilisé par le bot pour l'instant (Phase 11 RAG) |
| `OLLAMA_API_KEY` | env | passé en Bearer dans `httpx.post()` |
| `ANTHROPIC_API_KEY` | env | utilisé par le SDK Anthropic |

Le code ne logge jamais les tokens — la lib `pino` côté Next.js a une redaction, ici on évite simplement les `print(token)` côté Python.

## Troubleshooting

### Le bot ne démarre pas
```bash
sudo docker logs bot-ia --tail 50
```
Vérifier `DATABASE_URL` et `WS_TOKEN_ENCRYPTION_KEY` dans `/opt/matrix-synapse/.env`.

### Un agent ne répond pas
1. Statut `ENABLED` côté UI ? (`/agents`)
2. `RoomAgent.enabled = true` pour cette room ? (`/rooms/[id]`)
3. La mention contient bien `@<slug>` ? (en DM, pas besoin)
4. Logs : `sudo docker logs bot-ia | grep <slug>`

### E2EE — message non déchiffrable
- L'agent doit avoir rejoint la room **avant** le message (Matrix ne fait pas de backfill de clé Megolm)
- Vérifier les logs `nio.crypto.log`

## TODO — améliorations connues

- [ ] Reload chaud des configs d'agents existants (sans restart pour changer le prompt)
- [ ] Streaming des réponses dans Matrix (édit progressif via `m.replace`)
- [ ] Outils Claude pour RAG Moodle (Phase 11)
- [ ] Métriques Prometheus (`/metrics` HTTP)
- [ ] Alerte si un runner crashe N fois consécutives
