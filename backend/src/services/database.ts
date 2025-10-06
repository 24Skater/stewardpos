import config from '../config';
import { PostgresAdapter } from '../adapters/db/PostgresAdapter';
import { SQLiteAdapter } from '../adapters/db/SQLiteAdapter';
import logger from '../utils/logger';

type DatabaseAdapter = PostgresAdapter | SQLiteAdapter;

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
      const filename = config.database.filename || './data/persona-pos.db';
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
