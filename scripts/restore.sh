#!/usr/bin/env bash
#
# StewardPOS — restore a backup taken by scripts/backup.sh.
#
#   ./scripts/restore.sh ./backups/20260816-101500Z
#
# This **replaces** the current database. It asks before doing so, because the
# ordinary way to lose a shop's trading history is to restore the wrong backup
# over a working install.
#
# Restoring the database alone is usually not enough. If your JWT_SECRET differs
# from the one in force when the dump was taken, every session is invalidated;
# if POSTGRES_PASSWORD differs, the backend cannot connect at all. The backup
# carries an `env.txt` for exactly this reason.

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
SOURCE="${1:-}"

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

if [ -z "$SOURCE" ]; then
  echo "Usage: ./scripts/restore.sh <backup-directory>" >&2
  echo >&2
  echo "Available:" >&2
  ls -1 ./backups 2>/dev/null | sed 's/^/  .\/backups\//' >&2 || echo "  (none in ./backups)" >&2
  exit 1
fi

if [ ! -f "${SOURCE}/database.sql.gz" ]; then
  echo "❌ ${SOURCE}/database.sql.gz not found — that does not look like a StewardPOS backup." >&2
  exit 1
fi

if [ -f "${SOURCE}/MANIFEST" ]; then
  echo "About to restore:"
  sed 's/^/  /' "${SOURCE}/MANIFEST"
  echo
fi

DB_NAME="${POSTGRES_DB:-stewardpos}"
DB_USER="${POSTGRES_USER:-stewardpos_user}"

cat <<WARNING
⚠️  This REPLACES the contents of database "${DB_NAME}" on this host.
    Everything currently in it — orders, customers, staff accounts — is dropped
    and rebuilt from the backup. There is no undo.

WARNING

read -r -p "Type RESTORE to continue: " confirm
if [ "$confirm" != "RESTORE" ]; then
  echo "Cancelled."
  exit 1
fi

if ! compose ps --status running --services 2>/dev/null | grep -q '^postgres$'; then
  echo "❌ The postgres service is not running." >&2
  echo "   docker compose -f $COMPOSE_FILE up -d postgres" >&2
  exit 1
fi

# Stop the backend first. Restoring under a live application means the dump's
# DROPs contend with in-flight queries, and any sale rung up mid-restore is
# written into a database about to be replaced — it would simply vanish.
echo "⏸  Stopping the backend so nothing writes during the restore..."
compose stop backend >/dev/null 2>&1 || true

echo "📥 Restoring the database..."
gunzip -c "${SOURCE}/database.sql.gz" \
  | compose exec -T postgres psql --username "$DB_USER" --dbname "$DB_NAME" --quiet

if [ -f "${SOURCE}/uploads.tar.gz" ]; then
  echo "📥 Restoring uploads..."
  compose start backend >/dev/null
  # Wait for the container to accept an exec rather than assuming it is up.
  for _ in $(seq 1 30); do
    if compose exec -T backend true >/dev/null 2>&1; then break; fi
    sleep 1
  done
  # Clear the *contents*, never the directory.
  #
  # `/app/uploads` is a Docker volume mount, so `rm -rf /app/uploads` fails with
  # "Permission denied" no matter who the container runs as — a mount point
  # cannot be unlinked from inside. Found by running this rather than reading it.
  compose exec -T backend sh -c 'rm -rf /app/uploads/* /app/uploads/.[!.]* 2>/dev/null; exit 0'

  # `sh -c`, for the same reason as in backup.sh: a bare `-C /app` is rewritten
  # into a Windows path by Git Bash and the extraction silently goes nowhere.
  if ! compose exec -T backend sh -c 'cd /app && tar -xzf -' < "${SOURCE}/uploads.tar.gz"; then
    echo "❌ Restoring uploads failed. The database is restored; product images are not." >&2
    exit 1
  fi
else
  echo "ℹ️  No uploads in this backup."
fi

echo "▶️  Starting the stack..."
compose up -d

echo
echo "✅ Restore complete."
echo
if [ -f "${SOURCE}/env.txt" ]; then
  if [ -f .env ] && ! diff -q .env "${SOURCE}/env.txt" >/dev/null 2>&1; then
    cat <<'MISMATCH'
⚠️  The backup's env.txt differs from the current .env.

    If JWT_SECRET differs, every user is signed out — expected, and harmless.
    If POSTGRES_PASSWORD differs, the backend will not connect at all; the
    database you just restored was created under the backup's password, so the
    backup's value is the one that has to win.

    Compare them:  diff .env ENV_PATH
MISMATCH
    echo "                   (ENV_PATH = ${SOURCE}/env.txt)"
    echo
  fi
fi
echo "Verify before trusting it:"
echo "  docker compose -f $COMPOSE_FILE ps"
echo "  curl -fsS https://\$DOMAIN/api/health"
echo "  sign in, open Reports, and check a day you recognise"
