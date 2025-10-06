import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import Database from 'better-sqlite3';
import config from '../config';
import logger from '../utils/logger';

export class Migrator {
  private adapter: 'postgres' | 'sqlite';
  private pgPool?: Pool;
  private sqliteDb?: Database.Database;

  constructor() {
    this.adapter = config.database.adapter as 'postgres' | 'sqlite';
    
    if (this.adapter === 'postgres') {
      this.pgPool = new Pool({
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
        user: config.database.user,
        password: config.database.password,
      });
    } else if (this.adapter === 'sqlite') {
      const filename = config.database.filename || './data/persona-pos.db';
      // Ensure directory exists
      const dir = path.dirname(filename);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.sqliteDb = new Database(filename);
      this.sqliteDb.pragma('journal_mode = WAL');
      this.sqliteDb.pragma('foreign_keys = ON');
    }
  }

  async getCurrentVersion(): Promise<number> {
    try {
      if (this.adapter === 'postgres' && this.pgPool) {
        const result = await this.pgPool.query(
          'SELECT MAX(version) as version FROM schema_migrations'
        );
        return result.rows[0]?.version || 0;
      } else if (this.adapter === 'sqlite' && this.sqliteDb) {
        const result = this.sqliteDb
          .prepare('SELECT MAX(version) as version FROM schema_migrations')
          .get() as { version: number } | undefined;
        return result?.version || 0;
      }
    } catch (error) {
      // Table doesn't exist yet, return 0
      return 0;
    }
    return 0;
  }

  async runMigrations(): Promise<void> {
    logger.info(`Running migrations for ${this.adapter}...`);

    const migrationsDir = path.join(
      __dirname,
      '../../migrations',
      this.adapter
    );

    if (!fs.existsSync(migrationsDir)) {
      logger.warn(`No migrations directory found: ${migrationsDir}`);
      return;
    }

    const currentVersion = await this.getCurrentVersion();
    logger.info(`Current schema version: ${currentVersion}`);

    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let appliedCount = 0;

    for (const file of migrationFiles) {
      const version = parseInt(file.split('_')[0], 10);
      
      if (version <= currentVersion) {
        continue; // Already applied
      }

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      logger.info(`Applying migration: ${file}`);

      try {
        if (this.adapter === 'postgres' && this.pgPool) {
          await this.pgPool.query(sql);
        } else if (this.adapter === 'sqlite' && this.sqliteDb) {
          this.sqliteDb.exec(sql);
        }
        appliedCount++;
        logger.info(`✓ Migration ${file} applied successfully`);
      } catch (error) {
        logger.error(`✗ Migration ${file} failed:`, error);
        throw error;
      }
    }

    if (appliedCount === 0) {
      logger.info('No new migrations to apply');
    } else {
      logger.info(`✓ Applied ${appliedCount} migration(s)`);
    }
  }

  async close(): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.end();
    }
    if (this.sqliteDb) {
      this.sqliteDb.close();
    }
  }
}

// CLI runner
if (require.main === module) {
  const migrator = new Migrator();
  
  migrator
    .runMigrations()
    .then(() => {
      logger.info('Migration complete');
      return migrator.close();
    })
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Migration failed:', error);
      migrator.close().then(() => process.exit(1));
    });
}
