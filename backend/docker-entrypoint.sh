#!/bin/sh

echo "🚀 Starting stewardPOS Backend..."

# Wait for database to be ready (if using postgres)
if [ "$DB_ADAPTER" = "postgres" ]; then
  echo "⏳ Waiting for PostgreSQL to be ready..."
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
        console.log('✅ PostgreSQL is ready');
        pool.end();
        process.exit(0);
      })
      .catch((err) => {
        console.log('⏳ Still waiting... (' + err.message + ')');
        pool.end();
        process.exit(1);
      });
  "; do
    sleep 2
  done
  echo "✅ PostgreSQL is ready"
fi

# Run migrations using the compiled migrator
echo "📦 Running database migrations..."
if [ -f "dist/services/migrator.js" ]; then
  node dist/services/migrator.js || {
    echo "⚠️  Migration failed, but continuing..."
  }
else
  echo "⚠️  Migrator not found, skipping migrations..."
fi

# Seed database if AUTO_SEED is set
if [ "$AUTO_SEED" = "true" ]; then
  echo "🌱 Seeding database..."
  if [ -f "dist/services/seeder.js" ]; then
    node dist/services/seeder.js || {
      echo "⚠️  Seeding failed, but continuing..."
    }
  else
    echo "⚠️  Seeder not found, skipping seed..."
  fi
fi

# Start the server
echo "🚀 Starting server..."
exec node dist/server.js
