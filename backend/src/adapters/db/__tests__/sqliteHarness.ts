import { afterEach, beforeEach, describe } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import type { SQLiteAdapter } from '../SQLiteAdapter';

/**
 * Shared harness for the `sqlite*.test.ts` suites: a real, migrated SQLite
 * database per test, driven through the adapter's public methods.
 *
 * Same availability guard as `sqliteQueries.test.ts`: skips when the native
 * binding is missing (building it on Windows needs MSVC) and **throws in CI**,
 * where a skip would mean these cover nothing.
 *
 * The migrations run once per file into a template database; each test then
 * gets its own copy of that file, so tests cannot see each other's rows and
 * the migrator's cost is paid once rather than per test.
 */
function sqliteAvailable(): boolean {
  try {
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
}

export const available = sqliteAvailable();

if (!available && process.env.CI) {
  throw new Error(
    'better-sqlite3 has no usable native binding. In CI this is a failure, not a skip: ' +
      'these are the only tests that execute the SQLite adapter.'
  );
}

export const describeSqlite = available ? describe : describe.skip;

export interface SqliteHarness {
  adapter: SQLiteAdapter;
  /** Direct SQL, for arranging state the adapter has no method to create. */
  db: Database.Database;
  close: () => void;
}

let templatePromise: Promise<string> | undefined;

async function buildTemplate(): Promise<string> {
  const { default: config } = await import('../../../config');
  const original = { ...config.database };
  const filename = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-sqlite-tpl-')), 'template.db');

  config.database.adapter = 'sqlite';
  config.database.filename = filename;
  try {
    const { Migrator } = await import('../../../services/migrator');
    const migrator = new Migrator();
    await migrator.runMigrations();
    await migrator.close();
  } finally {
    Object.assign(config.database, original);
  }

  // Fold the WAL into the main file so a plain copy carries the whole schema.
  const db = new Database(filename);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('journal_mode = DELETE');
  db.close();
  return filename;
}

/** A fresh adapter over its own copy of the migrated template. */
export async function freshSqlite(): Promise<SqliteHarness> {
  templatePromise ??= buildTemplate();
  const template = await templatePromise;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-sqlite-'));
  const filename = path.join(dir, 'test.db');
  fs.copyFileSync(template, filename);

  const { SQLiteAdapter: Adapter } = await import('../SQLiteAdapter');
  const adapter = new Adapter({ filename });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');

  return {
    adapter,
    db,
    close: () => {
      db.close();
      adapter.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * A fresh database per test, inside the calling `describe`. Hooks registered
 * under `describeSqlite` never run when it is skipped, so this is a no-op on a
 * host without the native binding.
 */
export function useFreshSqlite(): SqliteHarness {
  const ctx = {} as SqliteHarness;
  beforeEach(async () => {
    Object.assign(ctx, await freshSqlite());
  });
  afterEach(() => {
    ctx.close?.();
  });
  return ctx;
}

/** Rows migrations seed into every database. */
export const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';
export const MAIN_LOCATION = '00000000-0000-0000-0000-0000000000a1';
export const MAIN_REGISTER = '00000000-0000-0000-0000-0000000000b1';

export function seedOrg(db: Database.Database, id: string, slug = id.slice(-6)): string {
  db.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(id, `Org ${slug}`, slug);
  return id;
}

export async function seedUser(
  adapter: SQLiteAdapter,
  email: string,
  name = email.split('@')[0]
): Promise<string> {
  const user = await adapter.createUser({ email, passwordHash: 'hash', name });
  return String(user.id);
}

/** A product with one variant of the given stock; returns both ids. */
export async function seedProduct(
  adapter: SQLiteAdapter,
  name: string,
  stock = 10,
  basePrice = 5
): Promise<{ productId: string; variantId: string }> {
  const product = await adapter.createProduct({
    name,
    description: 'seed',
    category: 'General',
    basePrice,
    variants: [{ sku: `${name}-SKU`, stock }],
  });
  const variants = product.variants as Record<string, unknown>[];
  return { productId: String(product.id), variantId: String(variants[0].id) };
}

/** Move a row's epoch-millisecond timestamp, for report windows. */
export function backdate(
  db: Database.Database,
  table: string,
  id: string,
  at: number,
  column = 'created_at'
): void {
  db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(at, id);
}
