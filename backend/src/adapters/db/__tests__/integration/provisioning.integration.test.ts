import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

/**
 * Provisioning a fresh install: migrate, then seed, on a database that has
 * never existed before.
 *
 * This is what a first deploy does, and what `reset-database` does. The seeder
 * was at ~1% coverage, so nothing verified that a fresh install actually
 * produces a working administrator — the failure mode being a deployed store
 * nobody can sign in to, discovered by trying.
 *
 * Runs against its own scratch database, created and dropped here, because
 * seeding writes a fixed set of rows that would otherwise collide with every
 * other integration test.
 */
const { default: config } = await import('../../../../config');

const original = { ...config.database };
const scratch = `stewardpos_test_seed_${Math.random().toString(36).slice(2, 8)}`;

let admin: Pool;
let db: Pool;
/**
 * Every pool opened against the scratch database, so all of them can be closed
 * before it is dropped. A pool left open holds the database and makes DROP
 * fail; terminating its backend instead makes it raise an unhandled connection
 * error, which vitest reports as a failed file even when every test passed.
 */
const closables: Array<{ close?: () => Promise<void>; end?: () => Promise<void> }> = [];

function connection(database: string): Pool {
  return new Pool({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database,
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
  });
}

beforeAll(async () => {
  if (!/test/i.test(String(process.env.DB_NAME))) {
    throw new Error('Refusing to provision: DB_NAME must contain "test".');
  }

  // `postgres` is the maintenance database — CREATE DATABASE cannot run inside
  // a transaction or against the database being created.
  admin = connection('postgres');
  await admin.query(`CREATE DATABASE ${scratch}`);

  config.database.adapter = 'postgres';
  config.database.name = scratch;
  config.database.host = process.env.DB_HOST ?? 'localhost';
  config.database.port = Number(process.env.DB_PORT ?? 5432);
  config.database.user = process.env.DB_USER ?? 'postgres';
  config.database.password = process.env.DB_PASSWORD ?? 'postgres';

  const { Migrator } = await import('../../../../services/migrator');
  const migrator = new Migrator();
  closables.push(migrator);
  await migrator.runMigrations();

  const { Seeder } = await import('../../../../services/seeder');
  const seeder = new Seeder();
  closables.push(seeder);
  await seeder.seed();

  db = connection(scratch);
  closables.push(db);
}, 120_000);

afterAll(async () => {
  await Promise.allSettled(closables.map((c) => (c.close ? c.close() : c.end?.())));
  Object.assign(config.database, original);

  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${scratch}`);
    await admin.end();
  }
});

describe('a freshly provisioned instance', () => {
  it('has an administrator who can be found by email', async () => {
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', ['admin@demo.local']);

    expect(rows).toHaveLength(1);
  });

  it('stores that administrator’s password hashed, never in plaintext', async () => {
    const { rows } = await db.query('SELECT password_hash FROM users WHERE email = $1', [
      'admin@demo.local',
    ]);

    expect(rows[0].password_hash).not.toBe('DemoPass!1');
    expect(await bcrypt.compare('DemoPass!1', String(rows[0].password_hash))).toBe(true);
  });

  it('gives that administrator the admin archetype, not merely a role named Admin', async () => {
    // `isAdmin` keys on `system_role`. Seeded with the wrong one, the account
    // exists, signs in, and can do nothing — which reads as a broken install.
    const { rows } = await db.query(
      `SELECT r.system_role FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.email = $1`,
      ['admin@demo.local']
    );

    expect(rows.map((r) => r.system_role)).toContain('admin');
  });

  it('leaves the administrator active', async () => {
    const { rows } = await db.query('SELECT status FROM users WHERE email = $1', [
      'admin@demo.local',
    ]);

    expect(rows[0].status).toBe('active');
  });

  it('creates the default roles', async () => {
    const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM roles');

    expect(rows[0].count).toBeGreaterThan(0);
  });

  it('gives every role a complete permission object', async () => {
    // A role missing a resource reads as denied for it. Seeded that way, a
    // whole job function is quietly unavailable from the first day.
    const { rows } = await db.query('SELECT name, permissions FROM roles');

    for (const role of rows) {
      const permissions = role.permissions as Record<string, unknown>;
      for (const resource of ['inventory', 'orders', 'returns', 'discounts', 'customers']) {
        expect(permissions[resource], `${role.name} has no ${resource}`).toBeTruthy();
      }
    }
  });

  it('creates the settings singleton', async () => {
    const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM settings');

    expect(rows[0].count).toBe(1);
  });

  it('seeds a catalog with sellable variants', async () => {
    // A register with no products is indistinguishable from a broken one.
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count FROM product_variants WHERE enabled = true AND stock > 0`
    );

    expect(rows[0].count).toBeGreaterThan(0);
  });

  it('gives every seeded product a category that exists', async () => {
    // `products.category` holds the name, so a seeded product naming a category
    // with no row is invisible to the category manager from day one.
    const { rows } = await db.query(
      `SELECT DISTINCT p.category FROM products p
       LEFT JOIN categories c ON c.name = p.category
       WHERE c.id IS NULL`
    );

    expect(rows.map((r) => r.category)).toEqual([]);
  });

  it('records the schema version it provisioned at', async () => {
    const { rows } = await db.query('SELECT MAX(version) AS version FROM schema_migrations');

    expect(Number(rows[0].version)).toBeGreaterThanOrEqual(14);
  });
});

describe('seeding twice', () => {
  it('does not duplicate the administrator', async () => {
    // `reset-database` reseeds, and the entrypoint seeds on every start when
    // AUTO_SEED is set. A second admin row would be a second way in.
    const { Seeder } = await import('../../../../services/seeder');
    const second = new Seeder();
    closables.push(second);
    await second.seed();

    const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM users WHERE email = $1', [
      'admin@demo.local',
    ]);

    expect(rows[0].count).toBe(1);
  });

  it('does not duplicate the settings row', async () => {
    const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM settings');

    expect(rows[0].count).toBe(1);
  });
});
