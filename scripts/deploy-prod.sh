#!/usr/bin/env bash
#
# StewardPOS — deploy the production stack.
#
#   ./scripts/deploy-prod.sh
#
# A thin wrapper around `docker compose -f docker-compose.prod.yml up -d` that
# takes a backup first and checks the things people forget. Running the compose
# command directly is fine and does the same thing, minus the backup.

set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "❌ $COMPOSE_FILE not found. Run this from the repository root." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cat >&2 <<'MISSING'
❌ No .env found.

   cp .env.prod.example .env
   # then fill it in — every secret generated, not invented:
   #   openssl rand -base64 32

   See docs/guides/install-vps.md.
MISSING
  exit 1
fi

# Read it without exporting the whole file into this shell: `export $(cat .env)`
# is the usual shortcut and it breaks on any value containing a space, which
# base64 secrets routinely do not but passphrases do.
get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- ; }

DOMAIN="$(get DOMAIN)"
JWT_SECRET="$(get JWT_SECRET)"
POSTGRES_PASSWORD="$(get POSTGRES_PASSWORD)"

missing=""
[ -z "$DOMAIN" ] && missing="${missing}\n   - DOMAIN"
[ -z "$JWT_SECRET" ] && missing="${missing}\n   - JWT_SECRET"
[ -z "$POSTGRES_PASSWORD" ] && missing="${missing}\n   - POSTGRES_PASSWORD"

if [ -n "$missing" ]; then
  # shellcheck disable=SC2059
  printf "❌ These are not set in .env:$missing\n" >&2
  exit 1
fi

# The backend enforces this itself and refuses to start; catching it here saves
# a build and a confusing restart loop.
case "$(printf '%s' "$JWT_SECRET" | tr '[:upper:]' '[:lower:]')" in
  change_this_min_32_characters_secret|changeme|secret|password)
    echo "❌ JWT_SECRET is still a placeholder. Generate one: openssl rand -base64 32" >&2
    exit 1
    ;;
esac

if [ "${#JWT_SECRET}" -lt 32 ]; then
  echo "❌ JWT_SECRET must be at least 32 characters." >&2
  exit 1
fi

echo "🚨 Deploying StewardPOS to production"
echo "   domain: $DOMAIN"
echo

# Only when something is already running — a first install has nothing to back
# up, and failing on that would be silly.
if docker compose -f "$COMPOSE_FILE" ps --status running --services 2>/dev/null | grep -q '^postgres$'; then
  echo "📦 Backing up first..."
  ./scripts/backup.sh
  echo
else
  echo "ℹ️  Nothing running yet; skipping the pre-deploy backup."
  echo
fi

read -r -p "Continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Cancelled."
  exit 1
fi

echo "🔨 Building..."
docker compose -f "$COMPOSE_FILE" build

echo "🚀 Starting..."
docker compose -f "$COMPOSE_FILE" up -d

echo
echo "✅ Deployed. Migrations run as the backend starts; watch them with:"
echo "   docker compose -f $COMPOSE_FILE logs -f backend"
echo
echo "Then verify:"
echo "   docker compose -f $COMPOSE_FILE ps"
echo "   curl -fsS https://$DOMAIN/api/health"
