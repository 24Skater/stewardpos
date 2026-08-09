import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

/**
 * First-run setup, driven end to end through the HTTP route.
 *
 * `/api/setup/complete` is the flow a fresh deployment runs once: it tests the
 * database connection, applies migrations, creates the administrator, and
 * writes the initial settings. `setup.guard.test.ts` and `setupRoutes.test.ts`
 * cover the guard that stops it running twice; nothing covered the flow itself,
 * which is the one that decides whether a new install is usable at all.
 *
 * Against its own scratch database, because it really does migrate and really
 * does create an account.
 *
 * **It mutates `process.env`** — that is how it points the running process at
 * the database just configured — so this file saves and restores those keys.
 * Integration tests run with `--no-file-parallelism`, so no other file is
 * reading them meanwhile.
 */
const scratch = `stewardpos_test_setup_${Math.random().toString(36).slice(2, 8)}`;

const ENV_KEYS = ['DB_ADAPTER', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'] as const;
const savedEnv: Record<string, string | undefined> = {};

let admin: Pool;
let db: Pool;

function connection(database: string): Pool {
  return new Pool({
    host: savedEnv.DB_HOST ?? 'localhost',
    port: Number(savedEnv.DB_PORT ?? 5432),
    database,
    user: savedEnv.DB_USER ?? 'postgres',
    password: savedEnv.DB_PASSWORD ?? 'postgres',
  });
}

const ADMIN = { name: 'Founder', email: 'founder@example.com', password: 'CorrectHorse1!' };

function body(overrides: Record<string, unknown> = {}) {
  return {
    adminUser: ADMIN,
    database: {
      adapter: 'postgres',
      host: savedEnv.DB_HOST ?? 'localhost',
      port: Number(savedEnv.DB_PORT ?? 5432),
      name: scratch,
      user: savedEnv.DB_USER ?? 'postgres',
      password: savedEnv.DB_PASSWORD ?? 'postgres',
    },
    auth: { methods: ['local'] },
    ...overrides,
  };
}

let app: import('express').Express;

beforeAll(async () => {
  if (!/test/i.test(String(process.env.DB_NAME))) {
    throw new Error('Refusing to run setup: DB_NAME must contain "test".');
  }
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

  admin = connection('postgres');
  await admin.query(`CREATE DATABASE ${scratch}`);

  app = (await import('../../../../app')).default;
  db = connection(scratch);
}, 120_000);

afterAll(async () => {
  await Promise.allSettled([db?.end()]);
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key] as string;
  }
  if (admin) {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [scratch]
    );
    await admin.query(`DROP DATABASE IF EXISTS ${scratch}`);
    await admin.end();
  }
  vi.restoreAllMocks();
});

describe('POST /api/setup/complete', () => {
  it('provisions an empty database', async () => {
    const response = await request(app).post('/api/setup/complete').send(body());

    expect(response.status).toBeLessThan(400);
  }, 120_000);

  it('creates the administrator it was given', async () => {
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [ADMIN.email]);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Founder');
  });

  it('stores that password hashed, and one that verifies', async () => {
    const { rows } = await db.query('SELECT password_hash FROM users WHERE email = $1', [
      ADMIN.email,
    ]);

    expect(rows[0].password_hash).not.toBe(ADMIN.password);
    expect(await bcrypt.compare(ADMIN.password, String(rows[0].password_hash))).toBe(true);
  });

  it('gives them the admin archetype, not merely a role called Administrator', async () => {
    // `isAdmin` keys on `system_role`. Seeded with the wrong one, the founding
    // account signs in and can do nothing — a new install that looks broken.
    const { rows } = await db.query(
      `SELECT r.system_role FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.email = $1`,
      [ADMIN.email]
    );

    expect(rows.map((r) => r.system_role)).toContain('admin');
  });

  it('grants that role every resource, not the seven it used to', async () => {
    // The permission list here was hand-written and had drifted, omitting
    // orders, returns, and discounts. Harmless while the archetype bypass
    // exists, and exactly the kind of thing that stops being harmless quietly.
    const { rows } = await db.query(
      `SELECT r.permissions FROM roles r WHERE r.system_role = 'admin' LIMIT 1`
    );

    const permissions = rows[0].permissions as Record<string, unknown>;
    for (const resource of [
      'inventory', 'reports', 'exports', 'settings', 'users',
      'services', 'customers', 'orders', 'returns', 'discounts',
    ]) {
      expect(permissions[resource], `admin role has no ${resource}`).toBeTruthy();
    }
  });

  it('applied the migrations', async () => {
    const { rows } = await db.query('SELECT MAX(version) AS version FROM schema_migrations');

    expect(Number(rows[0].version)).toBeGreaterThanOrEqual(14);
  });

  it('refuses to run a second time', async () => {
    // The whole point of the guard, now exercised against an instance this test
    // actually provisioned rather than a mocked one.
    const response = await request(app)
      .post('/api/setup/complete')
      .send(body({ adminUser: { ...ADMIN, email: 'attacker@evil.test' } }));

    expect(response.status).toBe(409);
  });

  it('did not create the second account it refused', async () => {
    const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [
      'attacker@evil.test',
    ]);

    expect(rows).toHaveLength(0);
  });
});
