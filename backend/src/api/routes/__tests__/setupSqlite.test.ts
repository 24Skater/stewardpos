import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

/**
 * The setup wizard on a SQLite install, and its connection test.
 *
 * The SQLite native binding does not build everywhere, so the adapter's `db`
 * handle is a fake that follows better-sqlite3's contract: `run()` returns
 * `{ changes, lastInsertRowid }`, and `lastInsertRowid` is SQLite's integer
 * rowid — not the table's `id`, which in every StewardPOS SQLite table is a
 * TEXT hex value (`migrations/sqlite/001_initial_schema.sql`).
 */
const sqlite = vi.hoisted(() => ({
  runs: [] as Array<{ sql: string; args: unknown[] }>,
  adminRole: undefined as { id: string } | undefined,
  usersTableExists: true,
  adminCount: 0,
  emailTaken: false,
}));

const fakeDb = {
  prepare: (sql: string) => ({
    get: () => {
      if (/sqlite_master/.test(sql)) return sqlite.usersTableExists ? { name: 'users' } : undefined;
      if (/COUNT\(\*\)/.test(sql)) return { count: sqlite.adminCount };
      if (/SELECT id FROM roles/.test(sql)) return sqlite.adminRole;
      return undefined;
    },
    run: (...args: unknown[]) => {
      sqlite.runs.push({ sql, args });
      const conflict = /INSERT INTO users/.test(sql) && sqlite.emailTaken;
      return { changes: conflict ? 0 : 1, lastInsertRowid: sqlite.runs.length };
    },
  }),
};

const reset = vi.fn();
const runMigrations = vi.fn();
const poolQuery = vi.fn();
const sqliteOpen = vi.fn();

vi.mock('../../../services/database', () => ({
  default: { getAdapter: () => ({ db: fakeDb }), reset },
}));
vi.mock('../../../services/migrator', () => ({
  Migrator: class {
    runMigrations = runMigrations;
    close = vi.fn();
  },
}));
vi.mock('../../../services/seeder', () => ({
  Seeder: class {
    seed = vi.fn();
    close = vi.fn();
  },
}));
vi.mock('pg', () => ({
  Pool: class {
    query = poolQuery;
    end = vi.fn();
  },
}));
vi.mock('better-sqlite3', () => ({
  default: class {
    constructor(filename: string) {
      sqliteOpen(filename);
    }
    prepare() {
      return { get: () => ({ 1: 1 }) };
    }
    close() {}
  },
}));

const { default: app } = await import('../../../app');
const { default: config } = await import('../../../config');

const original = { ...config.database };

const SETUP = {
  adminUser: { name: 'Owner', email: 'owner@shop.test', password: 'CorrectHorse1!' },
  database: { adapter: 'sqlite' as const, filename: './data/shop.db' },
  auth: { methods: ['local' as const] },
  environment: 'production' as const,
  demoMode: false,
};

const inserts = (table: string) =>
  sqlite.runs.filter((r) => new RegExp(`INSERT (OR IGNORE )?INTO ${table}\\b`).test(r.sql));

beforeEach(() => {
  vi.clearAllMocks();
  sqlite.runs = [];
  sqlite.adminRole = undefined;
  sqlite.usersTableExists = true;
  sqlite.adminCount = 0;
  sqlite.emailTaken = false;
  config.database.adapter = 'sqlite';
  runMigrations.mockResolvedValue(undefined);
});

// The route writes DB_* into the environment; restore it so nothing downstream
// (notably the integration harness, which reads DB_NAME) sees the wizard's values.
const originalEnv = { ...process.env };

afterEach(() => {
  Object.assign(config.database, original);
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('DB_') && !(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe('GET /api/setup/status on SQLite', () => {
  it('reports a fresh file as needing setup', async () => {
    sqlite.usersTableExists = false;

    const { body } = await request(app).get('/api/setup/status');

    expect(body.data).toMatchObject({ isInitialized: false, hasAdminUser: false, needsSetup: true, databaseAdapter: 'sqlite' });
  });

  it('reports a provisioned install as set up', async () => {
    sqlite.adminCount = 1;

    const { body } = await request(app).get('/api/setup/status');

    expect(body.data).toMatchObject({ isInitialized: true, hasAdminUser: true, needsSetup: false });
  });
});

describe('POST /api/setup/complete on SQLite', () => {
  it('opens the named file to check it, creates the admin role and the admin, and links them', async () => {
    const response = await request(app).post('/api/setup/complete').send(SETUP);

    expect(response.status).toBe(200);
    expect(sqliteOpen).toHaveBeenCalledWith('./data/shop.db');
    expect(config.database.filename).toBe('./data/shop.db');
    expect(reset).toHaveBeenCalled();
    expect(inserts('roles')).toHaveLength(1);
    const [email, hash, name, status] = inserts('users')[0].args as string[];
    expect({ email, name, status }).toEqual({ email: 'owner@shop.test', name: 'Owner', status: 'active' });
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(inserts('user_roles')).toHaveLength(1);
  });

  it('reuses an existing admin role rather than creating a second', async () => {
    sqlite.adminRole = { id: 'role-hex' };

    await request(app).post('/api/setup/complete').send(SETUP);

    expect(inserts('roles')).toHaveLength(0);
    expect(inserts('user_roles')[0].args[1]).toBe('role-hex');
  });

  it('refuses to take over an existing account’s email, and links no role', async () => {
    sqlite.emailTaken = true;

    const response = await request(app).post('/api/setup/complete').send(SETUP);

    expect(response.status).toBe(409);
    expect(inserts('user_roles')).toHaveLength(0);
  });

  it('is closed once an admin exists', async () => {
    sqlite.adminCount = 1;

    expect((await request(app).post('/api/setup/complete').send(SETUP)).status).toBe(409);
    expect(runMigrations).not.toHaveBeenCalled();
  });

  // BUG (routes/setup.ts, SQLite branch of POST /complete): the admin's
  // user_roles row is written with `userResult.lastInsertRowid` (and, when the
  // role was just created, `roleResult.lastInsertRowid`) — SQLite integer
  // rowids — while users.id / roles.id are TEXT hex ids. The link matches
  // nothing, so the founding admin has no role, getSetupState's join finds no
  // admin, and rejectIfAlreadySetUp never closes these unauthenticated setup
  // routes: anyone who can reach the API can run setup again and mint another
  // administrator. Same defect as services/seeder.ts.
  it.fails('links the admin role by the user’s id, not by a rowid', async () => {
    sqlite.adminRole = { id: 'role-hex' };

    await request(app).post('/api/setup/complete').send(SETUP);

    expect(typeof inserts('user_roles')[0].args[0]).toBe('string');
  });
});

describe('POST /api/setup/test-database', () => {
  beforeEach(() => {
    sqlite.usersTableExists = false;
  });

  it('reports a reachable Postgres', async () => {
    poolQuery.mockResolvedValue({ rows: [] });

    const response = await request(app)
      .post('/api/setup/test-database')
      .send({ adapter: 'postgres', host: 'db', port: '5432', name: 'shop', user: 'u', password: 'p' });

    expect(response.body).toEqual({ success: true, message: 'Database connection successful' });
  });

  it('reports an unreachable Postgres as a 400 with the reason', async () => {
    poolQuery.mockRejectedValue(new Error('ECONNREFUSED'));

    const response = await request(app).post('/api/setup/test-database').send({ adapter: 'postgres', host: 'db' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Database connection failed: ECONNREFUSED');
  });

  it('opens a SQLite file, defaulting the path', async () => {
    const response = await request(app).post('/api/setup/test-database').send({ adapter: 'sqlite' });

    expect(response.body.success).toBe(true);
    expect(sqliteOpen).toHaveBeenCalledWith('./data/stewardpos.db');
  });

  it('rejects an unknown adapter', async () => {
    expect((await request(app).post('/api/setup/test-database').send({ adapter: 'mysql' })).status).toBe(400);
  });
});
