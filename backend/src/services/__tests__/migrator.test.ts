import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

/**
 * The migration chain, applied for real against a throwaway SQLite file.
 *
 * The SQLite path is far less exercised than Postgres — every deployment here
 * uses Postgres — so its migrations can be written and never once run. Two of
 * them (`013_low_stock`, `014_org_tenancy`) were authored without ever being
 * executed against a database. A broken one fails at container boot, which is
 * the worst time to find out.
 *
 * A temp file rather than `:memory:` because the migrator opens the database
 * itself from config and sets WAL, which an in-memory database will not do.
 */
const { default: config } = await import('../../config');

/**
 * Whether `better-sqlite3`'s native binding actually loaded.
 *
 * It is compiled per platform and Node version, and building it on Windows
 * needs MSVC, which not every developer has. Failing the whole suite over a
 * missing toolchain would be disproportionate — but skipping silently is how
 * the adapters went uncovered in the first place, so **CI must run these**.
 * There the binding is always available, and a skip there is a failure.
 */
function sqliteAvailable(): boolean {
  try {
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
}

const available = sqliteAvailable();

if (!available && process.env.CI) {
  throw new Error(
    'better-sqlite3 has no usable native binding. In CI this is a failure, not a skip: ' +
      'SQLite is a supported adapter and these are the only tests that exercise it.'
  );
}

const describeSqlite = available ? describe : describe.skip;

const original = { ...config.database };
let filename: string;
let db: Database.Database;

beforeAll(async () => {
  if (!available) return;
  filename = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-mig-')), 'test.db');
  config.database.adapter = 'sqlite';
  config.database.filename = filename;

  const { Migrator } = await import('../migrator');
  await new Migrator().runMigrations();

  db = new Database(filename, { readonly: true });
}, 60_000);

afterAll(() => {
  if (!available) return;
  db?.close();
  Object.assign(config.database, original);
  fs.rmSync(path.dirname(filename), { recursive: true, force: true });
});

/** Column names on a table, as SQLite reports them. */
function columns(table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (row) => row.name
  );
}

const tables = (): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
    .map((row) => row.name);

describeSqlite('the SQLite migration chain', () => {
  it('applies every migration without error', () => {
    const applied = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
      count: number;
    };

    expect(applied.count).toBeGreaterThanOrEqual(15);
  });

  it('records the version it reached', () => {
    const { version } = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
      version: number;
    };

    expect(version).toBeGreaterThanOrEqual(15);
  });

  it('applies them in order, with no gaps', () => {
    // A gap means a file was skipped — which on Postgres would have been caught
    // by a later migration failing, and here would simply be missing schema.
    const rows = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;

    expect(rows.map((r) => r.version)).toEqual(rows.map((_, index) => index + 1));
  });

  it('creates the tables the application reads', () => {
    const present = tables();

    for (const table of [
      'users', 'roles', 'user_roles', 'products', 'product_variants',
      'orders', 'order_items', 'payments', 'customers', 'categories',
      'returns', 'return_items', 'store_credits', 'cash_drawer_sessions',
      'audit_logs', 'settings', 'api_keys', 'organizations',
    ]) {
      expect(present, `missing table: ${table}`).toContain(table);
    }
  });
});

describeSqlite('013_low_stock', () => {
  it('adds the threshold column', () => {
    expect(columns('product_variants')).toContain('low_stock_threshold');
  });

  it('leaves it nullable, so it can mean "use the store default"', () => {
    const column = (db.prepare('PRAGMA table_info(product_variants)').all() as Array<{
      name: string;
      notnull: number;
    }>).find((c) => c.name === 'low_stock_threshold');

    expect(column!.notnull).toBe(0);
  });
});

describeSqlite('014_org_tenancy', () => {
  it('creates the organizations table', () => {
    expect(tables()).toContain('organizations');
  });

  it('seeds exactly one default organization', () => {
    const rows = db.prepare('SELECT id, slug FROM organizations').all() as Array<{
      id: string;
      slug: string;
    }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('00000000-0000-0000-0000-000000000001');
    expect(rows[0].slug).toBe('default');
  });

  it('adds a nullable org_id to every tenant-scoped table', () => {
    // Nullable is the point: every existing row means "the default org", and a
    // NOT NULL column would have failed the migration on a populated database.
    for (const table of [
      'products', 'product_variants', 'orders', 'order_items', 'customers',
      'services', 'quotes', 'returns', 'audit_logs', 'roles', 'users',
      'settings', 'categories', 'payments', 'store_credits',
    ]) {
      const column = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
        notnull: number;
      }>).find((c) => c.name === 'org_id');

      expect(column, `${table} has no org_id`).toBeTruthy();
      expect(column!.notnull, `${table}.org_id is NOT NULL`).toBe(0);
    }
  });
});

describeSqlite('migration 015: locations and registers', () => {
  it('creates the locations and registers tables', () => {
    const present = tables();
    expect(present).toContain('locations');
    expect(present).toContain('registers');
  });

  it('gives registers the identity, capability and policy columns', () => {
    const cols = columns('registers');
    for (const col of [
      'id', 'org_id', 'location_id', 'name', 'register_number', 'display_code',
      'placement', 'type', 'has_cash_drawer', 'accepts_cash', 'can_refund',
      'can_open_drawer_no_sale', 'require_sign_in', 'idle_lock_seconds',
      'terminal_provider', 'terminal_device_id', 'status', 'last_seen_at',
    ]) {
      expect(cols, `registers is missing column: ${col}`).toContain(col);
    }
  });

  it('backfills one location and one register so existing history is attributable', () => {
    const loc = db.prepare("SELECT * FROM locations WHERE slug = 'main'").get() as
      { id: string; timezone: string } | undefined;
    expect(loc).toBeDefined();
    expect(loc!.timezone).toBe('UTC');

    const regs = db.prepare('SELECT * FROM registers').all() as Array<{
      display_code: string; register_number: number; status: string; location_id: string;
    }>;
    expect(regs).toHaveLength(1);
    expect(regs[0].display_code).toBe('MAIN-01');
    expect(regs[0].register_number).toBe(1);
    expect(regs[0].status).toBe('active');
    expect(regs[0].location_id).toBe(loc!.id);
  });

  it('defaults org policy to a 6-digit PIN and an unlimited register cap', () => {
    const org = db.prepare("SELECT * FROM organizations WHERE slug = 'default'").get() as
      { pin_length: number; max_registers: number | null };
    expect(org.pin_length).toBe(6);
    expect(org.max_registers).toBeNull();
  });

  it('declares the uniqueness the estate depends on', () => {
    const idx = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('registers','locations')"
    ).all() as Array<{ name: string }>).map((r) => r.name);
    expect(idx).toContain('idx_registers_loc_number');
    expect(idx).toContain('idx_registers_display_code');
    expect(idx).toContain('idx_locations_org_slug');
  });
});

describeSqlite('re-running', () => {
  it('is a no-op rather than an error', async () => {
    // The entrypoint runs migrations on every container start, so this happens
    // on every deploy. A migration applied twice would fail on a duplicate
    // column and take the container down.
    const { Migrator } = await import('../migrator');

    await expect(new Migrator().runMigrations()).resolves.not.toThrow();
  });

  it('does not double-record what it already applied', async () => {
    const before = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
      count: number;
    };
    const { Migrator } = await import('../migrator');
    await new Migrator().runMigrations();

    const after = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
      count: number;
    };
    expect(after.count).toBe(before.count);
  });
});
