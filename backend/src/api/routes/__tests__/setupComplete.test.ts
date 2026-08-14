import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

/**
 * `POST /api/setup/complete` — the provisioning flow itself.
 *
 * `setupRoutes.test.ts` proves the guard is mounted; the integration suite runs
 * the flow against a real Postgres. Neither covers what this file does: the
 * branches *inside* the flow, with the database mocked out, which is where the
 * decisions live that a green provisioning run would never reveal.
 *
 * This endpoint is unauthenticated by necessity — there is no account to sign
 * in with before setup — so every branch here is reachable by anyone who can
 * open a socket to a not-yet-provisioned instance. Two of the cases below are
 * the difference between a first-run wizard and a way to take over a store.
 */

const query = vi.fn();
const reset = vi.fn();
const runMigrations = vi.fn();
const migratorClose = vi.fn();
const seed = vi.fn();
const seederClose = vi.fn();
const poolQuery = vi.fn();
const poolEnd = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({ pool: { query } }),
    reset,
  },
}));

vi.mock('../../../services/migrator', () => ({
  Migrator: class {
    runMigrations = runMigrations;
    close = migratorClose;
  },
}));

vi.mock('../../../services/seeder', () => ({
  Seeder: class {
    seed = seed;
    close = seederClose;
  },
}));

vi.mock('pg', () => ({
  Pool: class {
    query = poolQuery;
    end = poolEnd;
  },
}));

const { default: app } = await import('../../../app');
const { default: config } = await import('../../../config');
const { PERMISSION_RESOURCES } = await import('../../middleware/authorize');

const VALID = {
  adminUser: { name: 'Owner', email: 'owner@shop.test', password: 'CorrectHorse1!' },
  database: {
    adapter: 'postgres' as const,
    host: 'db.internal',
    port: 5432,
    name: 'shop_live',
    user: 'shop',
    password: 'sup3rsecret',
  },
  auth: { methods: ['local' as const] },
  environment: 'production' as const,
  demoMode: false,
};

/** `config` is a module singleton the route deliberately mutates. */
const originalDatabaseConfig = { ...config.database };

/**
 * Answer `getSetupState`'s two questions as an un-provisioned instance, then
 * whatever the test wants for the admin-creation step.
 */
function adapterAnswers({ existingAdminRole = false, emailTaken = false } = {}) {
  query.mockImplementation(async (sql: string) => {
    // getSetupState: schema present, but no admin yet — so the guard lets us by.
    if (sql.includes('information_schema.tables')) return { rows: [{ exists: true }] };
    if (sql.includes("r.system_role = 'admin'")) return { rows: [{ count: '0' }] };

    if (sql.includes("SELECT id FROM roles")) {
      return { rows: existingAdminRole ? [{ id: 'role-1' }] : [] };
    }
    if (sql.includes('INSERT INTO roles')) return { rows: [{ id: 'role-1' }] };
    if (sql.includes('INSERT INTO users')) {
      return { rows: emailTaken ? [] : [{ id: 'user-1' }] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  adapterAnswers();
  poolQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
  runMigrations.mockResolvedValue(undefined);
  migratorClose.mockResolvedValue(undefined);
  seed.mockResolvedValue(undefined);
  seederClose.mockResolvedValue(undefined);
});

afterEach(() => {
  Object.assign(config.database, originalDatabaseConfig);
});

describe('validation', () => {
  it('refuses a password under eight characters', async () => {
    const response = await request(app)
      .post('/api/setup/complete')
      .send({ ...VALID, adminUser: { ...VALID.adminUser, password: 'short1!' } });

    expect(response.status).toBe(400);
  });

  it('refuses an address that is not an email', async () => {
    const response = await request(app)
      .post('/api/setup/complete')
      .send({ ...VALID, adminUser: { ...VALID.adminUser, email: 'not-an-email' } });

    expect(response.status).toBe(400);
  });

  it('refuses a setup with no authentication method at all', async () => {
    // An instance with no way to sign in is provisioned and unusable, and the
    // only route that could fix it refuses to run twice.
    const response = await request(app)
      .post('/api/setup/complete')
      .send({ ...VALID, auth: { methods: [] } });

    expect(response.status).toBe(400);
  });

  it('does not migrate anything when the body is invalid', async () => {
    await request(app).post('/api/setup/complete').send({ adminUser: {} });

    expect(runMigrations).not.toHaveBeenCalled();
  });
});

describe('step 1 — the database connection', () => {
  it('reports an unreachable database as a client error, not a crash', async () => {
    poolQuery.mockRejectedValueOnce(new Error('ECONNREFUSED 10.0.0.9:5432'));

    const response = await request(app).post('/api/setup/complete').send(VALID);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/connection failed/i);
  });

  it('does not echo the database password back to the caller', async () => {
    // The operator typed it into a form on an unauthenticated page; reflecting
    // it into an error body puts it in logs and proxies.
    poolQuery.mockRejectedValueOnce(new Error('password authentication failed for user "shop"'));

    const response = await request(app).post('/api/setup/complete').send(VALID);

    expect(JSON.stringify(response.body)).not.toContain(VALID.database.password);
  });

  it('closes the probe pool instead of leaking it', async () => {
    await request(app).post('/api/setup/complete').send(VALID);

    expect(poolEnd).toHaveBeenCalled();
  });

  it('stops before migrating when the connection fails', async () => {
    poolQuery.mockRejectedValueOnce(new Error('nope'));

    await request(app).post('/api/setup/complete').send(VALID);

    expect(runMigrations).not.toHaveBeenCalled();
  });
});

describe('step 2 — migrations', () => {
  it('points the process at the database the operator typed in', async () => {
    // Config is built once at import and the adapter is cached from it, so
    // without this the migrator, the seeder and the admin insert all land in
    // whatever database the process already had. That happened: setup reported
    // success having provisioned somewhere else entirely.
    await request(app).post('/api/setup/complete').send(VALID);

    expect(config.database.name).toBe('shop_live');
    expect(config.database.host).toBe('db.internal');
    expect(reset).toHaveBeenCalled();
  });

  it('leaves the existing configuration alone in demo mode', async () => {
    await request(app).post('/api/setup/complete').send({ ...VALID, demoMode: true });

    expect(config.database.name).toBe(originalDatabaseConfig.name);
    expect(reset).not.toHaveBeenCalled();
  });

  it('reports a migration failure as a server error', async () => {
    runMigrations.mockRejectedValueOnce(new Error('relation already exists'));

    const response = await request(app).post('/api/setup/complete').send(VALID);

    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/migration failed/i);
  });

  it('closes the migrator even when the migration throws', async () => {
    // The migrator opens its own pool. Leaving it open held connections against
    // the freshly provisioned database for the life of the process.
    runMigrations.mockRejectedValueOnce(new Error('boom'));

    await request(app).post('/api/setup/complete').send(VALID);

    expect(migratorClose).toHaveBeenCalled();
  });
});

describe('step 3 — the founding administrator', () => {
  it('grants every permission resource, not a hand-written subset', async () => {
    // This list drifted once already: it named seven resources and omitted
    // orders, returns and discounts. Harmless only for as long as the
    // `system_role: 'admin'` bypass exists.
    await request(app).post('/api/setup/complete').send(VALID);

    const roleInsert = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO roles'));
    expect(roleInsert, 'no admin role was created').toBeDefined();

    const permissions = JSON.parse(roleInsert![1][2]);

    expect(Object.keys(permissions).sort()).toEqual([...PERMISSION_RESOURCES].sort());
    for (const resource of PERMISSION_RESOURCES) {
      expect(permissions[resource]).toEqual({ read: true, write: true, delete: true });
    }
  });

  it('stores a hash, never the password itself', async () => {
    await request(app).post('/api/setup/complete').send(VALID);

    const userInsert = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO users'));
    const params = userInsert![1] as string[];

    expect(params).not.toContain(VALID.adminUser.password);
    expect(params[1]).toMatch(/^\$2[aby]\$/);
  });

  it('refuses to take over an address that already has an account', async () => {
    // The endpoint needs no credentials. An upsert here would let anyone reset
    // any existing user's password by claiming their email address.
    adapterAnswers({ existingAdminRole: true, emailTaken: true });

    const response = await request(app).post('/api/setup/complete').send(VALID);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/already exists/i);
  });

  it('reuses the admin role when one is already there', async () => {
    adapterAnswers({ existingAdminRole: true });

    await request(app).post('/api/setup/complete').send(VALID);

    const roleInsert = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO roles'));
    expect(roleInsert).toBeUndefined();
  });

  it('assigns the role to the account it just created', async () => {
    await request(app).post('/api/setup/complete').send(VALID);

    const assignment = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO user_roles'));

    expect(assignment).toBeDefined();
    expect(assignment![1]).toEqual(['user-1', 'role-1']);
  });

  it('reports a failure to create the administrator as a server error', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) return { rows: [{ exists: true }] };
      if (sql.includes("r.system_role = 'admin'")) return { rows: [{ count: '0' }] };
      throw new Error('permission denied for table roles');
    });

    const response = await request(app).post('/api/setup/complete').send(VALID);

    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/failed to create admin user/i);
  });
});

describe('step 4 — demo data', () => {
  it('seeds when demo mode is asked for', async () => {
    await request(app).post('/api/setup/complete').send({ ...VALID, demoMode: true });

    expect(seed).toHaveBeenCalled();
    expect(seederClose).toHaveBeenCalled();
  });

  it('does not seed otherwise', async () => {
    await request(app).post('/api/setup/complete').send(VALID);

    expect(seed).not.toHaveBeenCalled();
  });

  it('still completes when seeding fails, since demo data is not the point', async () => {
    seed.mockRejectedValueOnce(new Error('duplicate key'));

    const response = await request(app)
      .post('/api/setup/complete')
      .send({ ...VALID, demoMode: true });

    expect(response.status).toBe(200);
  });
});

describe('the response', () => {
  it('confirms the account and environment it provisioned', async () => {
    const response = await request(app).post('/api/setup/complete').send(VALID);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      adminEmail: VALID.adminUser.email,
      environment: 'production',
    });
  });

  it('does not return the password or its hash', async () => {
    const response = await request(app).post('/api/setup/complete').send(VALID);

    const body = JSON.stringify(response.body);
    expect(body).not.toContain(VALID.adminUser.password);
    expect(body).not.toMatch(/\$2[aby]\$/);
  });
});
