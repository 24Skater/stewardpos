#!/usr/bin/env bash
#
# StewardPOS — back up everything a shop cannot regenerate.
#
#   ./scripts/backup.sh [destination-directory]
#
# Writes one timestamped directory containing:
#
#   database.sql.gz   pg_dump of the whole database
#   uploads.tar.gz    product photos, logos, receipt images
#   env.txt           the .env in force, so a restore lands on the same secrets
#   MANIFEST          what was taken, from where, and when
#
# The database alone is not a backup. Uploads live on a Docker volume, and the
# `.env` holds JWT_SECRET and the database password — restoring a dump against a
# freshly generated JWT_SECRET signs out every user, and against a different
# POSTGRES_PASSWORD does not connect at all.
#
# Run it from the repository root, on the machine running the stack.

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DEST_ROOT="${1:-./backups}"
STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
DEST="${DEST_ROOT}/${STAMP}"

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "❌ $COMPOSE_FILE not found. Run this from the repository root." >&2
  exit 1
fi

if ! compose ps --status running --services 2>/dev/null | grep -q '^postgres$'; then
  echo "❌ The postgres service is not running; there is nothing to dump." >&2
  echo "   Start the stack first: docker compose -f $COMPOSE_FILE up -d" >&2
  exit 1
fi

mkdir -p "$DEST"
echo "📦 Backing up to $DEST"

DB_NAME="${POSTGRES_DB:-stewardpos}"
DB_USER="${POSTGRES_USER:-stewardpos_user}"

# --clean --if-exists so the dump can be replayed over an existing database
# without a manual drop; --no-owner so it restores under whatever role the
# target uses rather than demanding the original one exist.
echo "  · database"
compose exec -T postgres pg_dump \
  --username "$DB_USER" \
  --dbname "$DB_NAME" \
  --clean --if-exists --no-owner \
  | gzip > "${DEST}/database.sql.gz"

# Uploads come out of the running container rather than off the volume, so this
# needs no knowledge of Docker's storage layout and works the same on any host.
echo "  · uploads"
if ! compose ps --status running --services 2>/dev/null | grep -q '^backend$'; then
  echo "❌ The backend is not running, so uploads cannot be read." >&2
  echo "   Product photos and receipt logos would be missing from this backup." >&2
  exit 1
fi

# `sh -c` rather than passing `-C /app` as an argument.
#
# Git Bash on Windows rewrites anything that looks like an absolute Unix path
# into a Windows one, so `-C /app` reached the container as
# `C:/Program Files/Git/app` and tar failed. The single-quoted command is passed
# through untouched and interpreted by the container's own shell.
#
# The earlier version swallowed that failure and reported "no uploads directory
# yet", which is how a backup comes to be missing a shop's product photos while
# saying it succeeded.
if compose exec -T backend sh -c '[ -d /app/uploads ]'; then
  if ! compose exec -T backend sh -c 'cd /app && tar -czf - uploads' > "${DEST}/uploads.tar.gz"; then
    echo "❌ Could not read uploads from the backend container." >&2
    rm -f "${DEST}/uploads.tar.gz"
    exit 1
  fi
  # A zero-byte archive means the pipe produced nothing; better to fail than to
  # file it and find out during a restore.
  if [ ! -s "${DEST}/uploads.tar.gz" ]; then
    echo "❌ The uploads archive came out empty." >&2
    rm -f "${DEST}/uploads.tar.gz"
    exit 1
  fi
else
  echo "    (this install has no uploads directory)"
fi

# The secrets, because a dump restored under different ones is not a restore.
# This file contains credentials: the whole backup directory is as sensitive as
# the database inside it.
echo "  · environment"
if [ -f .env ]; then
  cp .env "${DEST}/env.txt"
  chmod 600 "${DEST}/env.txt"
else
  echo "    (no .env found — record your secrets separately or the restore will not connect)"
fi

{
  echo "StewardPOS backup"
  echo "taken:    $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  echo "host:     $(hostname)"
  echo "compose:  $COMPOSE_FILE"
  echo "database: $DB_NAME (user $DB_USER)"
  echo "git:      $(git rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout')"
  echo
  echo "Restore with: ./scripts/restore.sh $DEST"
} > "${DEST}/MANIFEST"

chmod 700 "$DEST"

echo "✅ Backup complete: $DEST"
du -sh "$DEST" 2>/dev/null || true
echo
echo "⚠️  Copy it off this machine. A backup on the server it protects is not a backup."
echo "   Example:  rsync -a $DEST backup-host:/srv/stewardpos-backups/"
echo
echo "   And test it: an untested restore is a hope, not a plan."
echo "   See docs/guides/backup-restore.md."
