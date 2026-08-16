#!/bin/sh
#
# Container start: wait for the database, migrate, optionally seed, then serve.
#
# Migrations run here rather than in a separate deploy step so that an operator
# following the upgrade guide — `git pull`, `up -d` — gets the schema their code
# expects without a second command to forget.

set -e

echo "🚀 Starting StewardPOS backend..."

# Wait for database to be ready (if using postgres)
if [ "$DB_ADAPTER" = "postgres" ]; then
  echo "⏳ Waiting for PostgreSQL to be ready..."
  attempt=0
  until node -e "
    const { Pool } = require('pg');
    const pool = new Pool({
      host: process.env.DB_HOST || 'postgres',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'stewardpos',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
    });
    pool.query('SELECT 1')
      .then(() => {
        pool.end();
        process.exit(0);
      })
      .catch((err) => {
        console.log('⏳ Still waiting... (' + err.message + ')');
        pool.end();
        process.exit(1);
      });
  "; do
    attempt=$((attempt + 1))
    # Bounded, so a permanently wrong DB_HOST or password surfaces as a failed
    # container rather than one that sits in "Starting" forever and looks like a
    # slow boot. Five minutes is longer than any cold Postgres start.
    if [ "$attempt" -ge 150 ]; then
      echo "❌ PostgreSQL did not become reachable after 5 minutes."
      echo "   Check DB_HOST, DB_NAME, DB_USER and DB_PASSWORD, and that the database container is healthy."
      exit 1
    fi
    sleep 2
  done
  echo "✅ PostgreSQL is ready"
fi

# Run migrations.
#
# A failure here is fatal, and that is a deliberate change: this used to print
# "Migration failed, but continuing..." and start the server anyway. The server
# then ran against a schema its code did not match, which surfaces later as
# scattered 500s on whichever endpoint touches the missing column — far from the
# migration that actually failed, and after the shop has started trading on it.
# Refusing to start is louder and cheaper.
echo "📦 Running database migrations..."
if [ -f "dist/services/migrator.js" ]; then
  if ! node dist/services/migrator.js; then
    echo "❌ Migration failed. The server will not start against a schema it does not match."
    echo "   See docs/guides/upgrade.md for how to recover."
    exit 1
  fi
else
  echo "❌ Migrator not found at dist/services/migrator.js — the image is built wrong."
  exit 1
fi

# Seed only when asked.
#
# The seeder has its own guards — it refuses in production and skips a database
# that already has users — because AUTO_SEED lives in a .env file one line from
# the settings an operator is editing, and what it writes is an administrator
# whose password is published in this repository.
if [ "$AUTO_SEED" = "true" ]; then
  echo "🌱 AUTO_SEED is set; seeding if this database is new..."
  if [ -f "dist/services/seeder.js" ]; then
    if ! node dist/services/seeder.js; then
      # Not fatal: an install whose seed failed still has a migrated schema and a
      # working setup wizard, which is a recoverable position. A failed migration
      # is not.
      echo "⚠️  Seeding failed. The schema is in place; create the first user through the setup wizard."
    fi
  else
    echo "⚠️  Seeder not found; skipping."
  fi
fi

echo "🚀 Starting server..."
exec node dist/server.js
