#!/bin/bash
# Déploiement complet d'aibotmanager (UI Next.js + bot Python).
#
# Usage : ./scripts/deploy.sh [--skip-bot] [--skip-app]
#   --skip-bot : ne pas rebuild/restart le bot Python
#   --skip-app : ne pas rebuild/restart l'UI Next.js
#
# À lancer après un `git pull` typiquement.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
SKIP_BOT=0
SKIP_APP=0

for arg in "$@"; do
  case "$arg" in
    --skip-bot) SKIP_BOT=1 ;;
    --skip-app) SKIP_APP=1 ;;
    *) echo "Argument inconnu : $arg" >&2; exit 1 ;;
  esac
done

# ─── 1. Dépendances Node ──────────────────────────────────────────────────
echo "▶ Installation des deps pnpm..."
pnpm install --frozen-lockfile

# ─── 2. Schéma Prisma + génération client ──────────────────────────────────
echo "▶ Génération du client Prisma..."
pnpm exec prisma generate
echo "▶ Sync du schéma DB..."
pnpm exec prisma db push

# ─── 3. UI Next.js ─────────────────────────────────────────────────────────
if [ $SKIP_APP -eq 0 ]; then
  echo "▶ Build production Next.js..."
  pnpm build
  echo "▶ Restart aibotmanager (systemd)..."
  sudo systemctl restart aimatrixmanager
  sleep 3
  sudo systemctl is-active aimatrixmanager
else
  echo "⏭️  UI Next.js skipped"
fi

# ─── 4. Bot Python ─────────────────────────────────────────────────────────
if [ $SKIP_BOT -eq 0 ]; then
  echo "▶ Rebuild + restart du bot Python..."
  cd /opt/matrix-synapse
  sudo docker compose up -d --build bot-ia
  sleep 5
  sudo docker logs bot-ia --since 30s | grep -E "📋|prêt|ERROR" | tail -10
else
  echo "⏭️  Bot Python skipped"
fi

echo "✅ Déploiement terminé"
