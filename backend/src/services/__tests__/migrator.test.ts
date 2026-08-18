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

    expect(applied.count).toBeGreaterThanOrEqual(17);
  });

  it('records the version it reached', () => {
    const { version } = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
      version: number;
    };

    expect(version).toBeGreaterThanOrEqual(17);
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

describeSqlite('015_registers', () => {
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

  it('defaults every register to a fully capable, pending till', () => {
    // A name-only roll-call would still pass if someone "fixed"
    // has_cash_drawer to DEFAULT FALSE while chasing an unrelated bug — every
    // new register would then lose its drawer and refuse cash tender with
    // this suite still green. These defaults are the security posture of a
    // register, so they're pinned directly, the same way 013 and 014 pin
    // nullability rather than just column presence.
    const info = (db.prepare('PRAGMA table_info(registers)').all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>);
    const column = (name: string) => info.find((c) => c.name === name)!;

    for (const flag of ['has_cash_drawer', 'accepts_cash', 'can_refund']) {
      const col = column(flag);
      expect(col.notnull, `${flag} is nullable`).toBe(1);
      expect(col.dflt_value, `${flag} does not default to true`).toBe('1');
    }

    const noSale = column('can_open_drawer_no_sale');
    expect(noSale.notnull, 'can_open_drawer_no_sale is nullable').toBe(1);
    expect(noSale.dflt_value, 'can_open_drawer_no_sale does not default to false').toBe('0');

    const idle = column('idle_lock_seconds');
    expect(idle.notnull, 'idle_lock_seconds is nullable').toBe(1);
    expect(idle.dflt_value, 'idle_lock_seconds default drifted').toBe('300');

    const status = column('status');
    expect(status.notnull, 'status is nullable').toBe(1);
    expect(status.dflt_value, 'status does not default to pending').toBe("'pending'");

    const type = column('type');
    expect(type.notnull, 'type is nullable').toBe(1);
    expect(type.dflt_value, 'type does not default to fixed').toBe("'fixed'");
  });

  it('backfills one location and one register so existing history is attributable', () => {
    const loc = db.prepare("SELECT * FROM locations WHERE slug = 'main'").get() as
      { id: string; org_id: string; timezone: string } | undefined;
    expect(loc).toBeDefined();
    expect(loc!.timezone).toBe('UTC');
    // The default org, explicitly — org_id is the column most likely to go
    // silently NULL now that it's NOT NULL only by migration-time backfill,
    // not by a schema default.
    expect(loc!.org_id).toBe('00000000-0000-0000-0000-000000000001');

    const regs = db.prepare('SELECT * FROM registers').all() as Array<{
      display_code: string; register_number: number; status: string; location_id: string; org_id: string;
    }>;
    expect(regs).toHaveLength(1);
    expect(regs[0].display_code).toBe('MAIN-01');
    expect(regs[0].register_number).toBe(1);
    expect(regs[0].status).toBe('active');
    expect(regs[0].location_id).toBe(loc!.id);
    expect(regs[0].org_id).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('defaults org policy to a 6-digit PIN and an unlimited register cap', () => {
    const org = db.prepare("SELECT * FROM organizations WHERE slug = 'default'").get() as
      { pin_length: number; max_registers: number | null };
    expect(org.pin_length).toBe(6);
    expect(org.max_registers).toBeNull();
  });

  it('declares the uniqueness the estate depends on', () => {
    // Reading names off sqlite_master only proves an index exists under that
    // name — it would stay green if someone edited
    // `CREATE UNIQUE INDEX idx_registers_display_code` down to a plain
    // `CREATE INDEX`, or reordered its columns to (display_code, org_id).
    // PRAGMA index_list carries the `unique` flag and PRAGMA index_info
    // carries column order, which is what the uniqueness this migration
    // promises actually rests on.
    const uniqueColumns = (table: string, indexName: string): string[] => {
      const list = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{
        name: string;
        unique: number;
      }>;
      const entry = list.find((i) => i.name === indexName);
      expect(entry, `${indexName} does not exist on ${table}`).toBeTruthy();
      expect(entry!.unique, `${indexName} is not a unique index`).toBe(1);

      return (db.prepare(`PRAGMA index_info(${indexName})`).all() as Array<{ name: string }>).map(
        (c) => c.name
      );
    };

    expect(uniqueColumns('registers', 'idx_registers_loc_number')).toEqual([
      'location_id', 'register_number',
    ]);
    expect(uniqueColumns('registers', 'idx_registers_display_code')).toEqual([
      'org_id', 'display_code',
    ]);
    expect(uniqueColumns('locations', 'idx_locations_org_slug')).toEqual(['org_id', 'slug']);
  });
});

describeSqlite('016_register_attribution', () => {
  it('adds the attribution columns to orders, returns, payments and cash_drawer_sessions', () => {
    expect(columns('orders')).toEqual(
      expect.arrayContaining(['register_id', 'cashier_user_id', 'drawer_session_id', 'override_by_user_id'])
    );
    expect(columns('returns')).toEqual(
      expect.arrayContaining(['register_id', 'cashier_user_id', 'override_by_user_id'])
    );
    expect(columns('payments')).toContain('register_id');
    expect(columns('cash_drawer_sessions')).toEqual(
      expect.arrayContaining(['register_id', 'shift_id'])
    );
  });

  it('leaves zero rows with a NULL register_id after the backfill', () => {
    // The whole point of the per-org backfill: every historical row, on any
    // organisation, must resolve to *some* register — never silently left
    // unattributed and never all pointed at the default org's till.
    for (const table of ['orders', 'returns', 'payments', 'cash_drawer_sessions']) {
      const { count } = db
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE register_id IS NULL`)
        .get() as { count: number };
      expect(count, `${table} has rows with a NULL register_id`).toBe(0);
    }
  });

  it('removes the old install-wide one-open-drawer index', () => {
    const list = db.prepare('PRAGMA index_list(cash_drawer_sessions)').all() as Array<{
      name: string;
    }>;
    expect(list.map((i) => i.name)).not.toContain('idx_drawer_one_open');
  });

  it('replaces it with a unique per-register one-open-drawer index', () => {
    // Same reasoning as 015's uniqueness test: a name-only check from
    // sqlite_master would stay green even if the index were edited down to a
    // non-unique index, or its columns reordered to (status, register_id),
    // either of which would silently readmit the global one-drawer bug this
    // migration exists to fix.
    const list = db.prepare('PRAGMA index_list(cash_drawer_sessions)').all() as Array<{
      name: string;
      unique: number;
    }>;
    const entry = list.find((i) => i.name === 'idx_drawer_one_open_per_register');
    expect(entry, 'idx_drawer_one_open_per_register does not exist').toBeTruthy();
    expect(entry!.unique, 'idx_drawer_one_open_per_register is not a unique index').toBe(1);

    const cols = (
      db.prepare('PRAGMA index_info(idx_drawer_one_open_per_register)').all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    expect(cols).toEqual(['register_id', 'status']);
  });
});

describeSqlite('017_register_credentials', () => {
  it('creates the register_credentials table', () => {
    expect(tables()).toContain('register_credentials');
  });

  it('gives it the pairing, token, and revocation columns', () => {
    const cols = columns('register_credentials');
    for (const col of [
      'id', 'register_id',
      'pairing_code_prefix', 'pairing_code_hash', 'pairing_expires_at',
      'token_prefix', 'token_hash', 'enrolled_at', 'last_used_at',
      'revoked_at', 'revoked_by', 'revoke_reason',
      'created_by', 'created_at',
    ]) {
      expect(cols, `register_credentials is missing column: ${col}`).toContain(col);
    }
  });

  it('requires register_id and the pairing code columns, but leaves the token columns nullable until redemption', () => {
    const info = (db.prepare('PRAGMA table_info(register_credentials)').all() as Array<{
      name: string;
      notnull: number;
    }>);
    const column = (name: string) => info.find((c) => c.name === name)!;

    for (const required of [
      'register_id', 'pairing_code_prefix', 'pairing_code_hash', 'pairing_expires_at',
    ]) {
      expect(column(required).notnull, `${required} is nullable`).toBe(1);
    }

    for (const optional of ['token_prefix', 'token_hash', 'enrolled_at', 'revoked_at']) {
      expect(column(optional).notnull, `${optional} is NOT NULL`).toBe(0);
    }
  });

  it(
    'declares TWO separate partial unique indexes — one outstanding pairing code and ' +
      'one enrolled credential per register — not one index covering both',
    () => {
      // Reading names off sqlite_master only proves an index exists under
      // that name — the same trap the 015/016 uniqueness tests guard
      // against. PRAGMA index_list carries the `unique`/`partial` flags and
      // PRAGMA index_info carries the column, which is what each index's
      // guarantee actually rests on. Two indexes, not one, is the point:
      // a single `WHERE revoked_at IS NULL` index would forbid an
      // outstanding pairing code from ever coexisting with a live token,
      // which is exactly what makes issuing a code non-destructive.
      const list = db.prepare('PRAGMA index_list(register_credentials)').all() as Array<{
        name: string;
        unique: number;
        partial: number;
      }>;

      for (const name of [
        'idx_register_credentials_one_pairing_per_register',
        'idx_register_credentials_one_enrolled_per_register',
      ]) {
        const entry = list.find((i) => i.name === name);
        expect(entry, `${name} does not exist`).toBeTruthy();
        expect(entry!.unique, `${name} is not a unique index`).toBe(1);
        expect(entry!.partial, `${name} is not a partial index`).toBe(1);

        const cols = (
          db.prepare(`PRAGMA index_info(${name})`).all() as Array<{ name: string }>
        ).map((c) => c.name);
        expect(cols).toEqual(['register_id']);
      }
    }
  );

  it('lets an outstanding pairing row and an enrolled credential coexist for the same register, in real SQLite', () => {
    // `db` here is opened `{ readonly: true }` (see the top of this file),
    // so this can't INSERT against it. A throwaway in-memory database with
    // just this one table's DDL, copied verbatim from the migration file,
    // is enough to prove the two indexes behave as independent constraints
    // rather than exercise a full migration run again.
    const scratch = new Database(':memory:');
    scratch.exec(`
      CREATE TABLE register_credentials (
        id TEXT PRIMARY KEY,
        register_id TEXT NOT NULL,
        pairing_code_prefix TEXT NOT NULL,
        pairing_code_hash TEXT NOT NULL,
        pairing_expires_at INTEGER NOT NULL,
        token_prefix TEXT,
        token_hash TEXT,
        enrolled_at INTEGER,
        revoked_at INTEGER
      );
      CREATE UNIQUE INDEX idx_register_credentials_one_pairing_per_register
        ON register_credentials(register_id) WHERE revoked_at IS NULL AND token_hash IS NULL;
      CREATE UNIQUE INDEX idx_register_credentials_one_enrolled_per_register
        ON register_credentials(register_id) WHERE revoked_at IS NULL AND token_hash IS NOT NULL;
    `);

    const insertEnrolled = scratch.prepare(
      `INSERT INTO register_credentials
        (id, register_id, pairing_code_prefix, pairing_code_hash, pairing_expires_at, token_prefix, token_hash)
       VALUES (?, 'r1', 'AAAA', 'h', 1, 'srt_x', 'hash')`
    );
    const insertPairing = scratch.prepare(
      `INSERT INTO register_credentials
        (id, register_id, pairing_code_prefix, pairing_code_hash, pairing_expires_at)
       VALUES (?, 'r1', 'BBBB', 'h', 1)`
    );

    expect(() => insertEnrolled.run('enrolled-1')).not.toThrow();
    // The SAME register also holding a live, outstanding pairing code must
    // be permitted — this is the exact case a single combined index would
    // have forbidden, forcing the destructive behavior this migration
    // amendment removes.
    expect(() => insertPairing.run('pairing-1')).not.toThrow();

    // A SECOND of either kind must still collide with the first of its own kind.
    expect(() => insertEnrolled.run('enrolled-2')).toThrow();
    expect(() => insertPairing.run('pairing-2')).toThrow();

    scratch.close();
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
