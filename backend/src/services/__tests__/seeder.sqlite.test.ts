import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The seeder's SQLite path, driven through a fake `better-sqlite3`.
 *
 * The native binding is not buildable on every developer machine, and the
 * guard tests in `seeder.guards.test.ts` cover only the decision to seed. The
 * fake follows better-sqlite3's documented contract: `run()` returns
 * `{ changes, lastInsertRowid }`, where `lastInsertRowid` is SQLite's integer
 * rowid — *not* the table's `id` column, which in every StewardPOS SQLite table
 * is a TEXT hex value (`migrations/sqlite/001_initial_schema.sql`).
 */
interface Stmt {
  sql: string;
  args: unknown[];
}

const db = vi.hoisted(() => ({
  runs: [] as Stmt[],
  users: 0,
  existingBarcodes: new Set<string>(),
  adminRole: { id: 'role-admin-hex' } as { id: string } | undefined,
  closed: false,
}));

vi.mock('pg', () => ({ Pool: class {} }));

vi.mock('better-sqlite3', () => ({
  default: class {
    prepare(sql: string) {
      return {
        get: (...args: unknown[]) => {
          if (/RETURNING id/i.test(sql)) {
            db.runs.push({ sql, args });
            return { id: `hex-${db.runs.length}` };
          }
          if (/COUNT\(\*\)/i.test(sql)) return { count: db.users };
          if (/FROM roles/i.test(sql)) return db.adminRole;
          if (/FROM products WHERE barcode/i.test(sql)) {
            return db.existingBarcodes.has(String(args[0])) ? { id: 'existing' } : undefined;
          }
          return undefined;
        },
        run: (...args: unknown[]) => {
          db.runs.push({ sql, args });
          return { changes: 1, lastInsertRowid: db.runs.length };
        },
      };
    }
    close() {
      db.closed = true;
    }
  },
}));

const { default: config } = await import('../../config');
const { Seeder } = await import('../seeder');

const original = { adapter: config.database.adapter, nodeEnv: config.nodeEnv };

const inserts = (table: string) =>
  db.runs.filter((s) => new RegExp(`INSERT (OR IGNORE )?INTO ${table}\\b`, 'i').test(s.sql));

beforeEach(() => {
  db.runs = [];
  db.users = 0;
  db.existingBarcodes = new Set();
  db.adminRole = { id: 'role-admin-hex' };
  db.closed = false;
  config.database.adapter = 'sqlite';
  config.nodeEnv = 'development';
});

afterEach(() => {
  config.database.adapter = original.adapter;
  config.nodeEnv = original.nodeEnv;
});

describe('Seeder on SQLite', () => {
  it('seeds an empty database: roles, admin, settings, categories, and one variant per product', async () => {
    await new Seeder().seed();

    expect(inserts('roles').length).toBeGreaterThan(0);
    expect(inserts('users')).toHaveLength(1);
    expect(inserts('settings')).toHaveLength(1);
    expect(inserts('categories')).toHaveLength(3);
    expect(inserts('products')).toHaveLength(12);
    expect(inserts('product_variants')).toHaveLength(12);
  });

  it('stores a bcrypt hash for the admin password and PIN, never the plaintext', async () => {
    await new Seeder().seed();

    const [email, passwordHash, , status, pinHash] = inserts('users')[0].args as string[];
    expect(email).toBe('admin@demo.local');
    expect(status).toBe('active');
    expect(passwordHash).toMatch(/^\$2[aby]\$/);
    expect(pinHash).toMatch(/^\$2[aby]\$/);
    expect(passwordHash).not.toContain('DemoPass');
  });

  it('declines a database that already has users', async () => {
    db.users = 2;

    await new Seeder().seed();

    expect(db.runs).toHaveLength(0);
  });

  it('skips products whose barcode already exists, and gives them no new variant', async () => {
    db.existingBarcodes = new Set(['101', '201']);

    await new Seeder().seed(true);

    expect(inserts('products')).toHaveLength(10);
    expect(inserts('product_variants')).toHaveLength(10);
    expect(inserts('products').map((s) => s.args[4])).not.toContain('101');
  });

  it('assigns no role when the admin role is missing, rather than inventing one', async () => {
    db.adminRole = undefined;

    await new Seeder().seed();

    expect(inserts('user_roles')).toHaveLength(0);
  });

  it('closes the database handle', async () => {
    await new Seeder().close();

    expect(db.closed).toBe(true);
  });

  it('links the admin role to the admin user’s id, not to a rowid', async () => {
    await new Seeder().seed();

    const [userId] = inserts('user_roles')[0].args;
    expect(typeof userId).toBe('string');
  });

  it('links each variant to its product’s id, not to a rowid', async () => {
    await new Seeder().seed();

    expect(inserts('product_variants').every((s) => typeof s.args[0] === 'string')).toBe(true);
  });
});
