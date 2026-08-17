import config from '../config';
import { PostgresAdapter } from '../adapters/db/PostgresAdapter';
import { SQLiteAdapter } from '../adapters/db/SQLiteAdapter';
import logger from '../utils/logger';

export type DatabaseAdapter = PostgresAdapter | SQLiteAdapter;

class DatabaseService {
  private static instance: DatabaseService;
  private adapter: DatabaseAdapter | null = null;

  private constructor() {}

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  getAdapter(): DatabaseAdapter {
    if (!this.adapter) {
      this.adapter = this.createAdapter();
    }
    return this.adapter;
  }

  /**
   * Drop the cached adapter so the next call rebuilds it from current config.
   *
   * Needed by first-run setup, which is told at request time which database to
   * use. Without this the adapter stays bound to whatever `config` held at
   * import — so setup would report success while having provisioned the
   * database the process was already pointed at, ignoring the one the operator
   * typed in. Verified: it created the administrator in the wrong database.
   *
   * Nothing else should call this. Swapping the database under a running server
   * is a first-run action, not an operational one.
   */
  async reset(): Promise<void> {
    const previous = this.adapter;
    this.adapter = null;
    // Closed after clearing, so a failure to close cannot leave the stale
    // adapter installed.
    try {
      await previous?.close?.();
    } catch {
      // A pool that will not close cleanly must not stop setup from continuing;
      // the adapter has already been discarded either way.
    }
  }

  private createAdapter(): DatabaseAdapter {
    const adapterType = config.database.adapter;

    logger.info(`Initializing ${adapterType} database adapter`);

    if (adapterType === 'postgres') {
      if (!config.database.host || !config.database.name || !config.database.user) {
        throw new Error('PostgreSQL configuration is incomplete');
      }

      return new PostgresAdapter({
        host: config.database.host,
        port: config.database.port || 5432,
        database: config.database.name,
        user: config.database.user,
        password: config.database.password || '',
        ssl: false,
      });
    } else if (adapterType === 'sqlite') {
      const filename = config.database.filename || './data/stewardpos.db';
      return new SQLiteAdapter({ filename });
    } else {
      throw new Error(`Unsupported database adapter: ${adapterType}`);
    }
  }

  async testConnection(): Promise<boolean> {
    const adapter = this.getAdapter();
    return adapter.testConnection();
  }

  async close(): Promise<void> {
    if (this.adapter) {
      if ('close' in this.adapter && typeof this.adapter.close === 'function') {
        await this.adapter.close();
      }
      this.adapter = null;
    }
  }
}

export const db = DatabaseService.getInstance();
export default db;
