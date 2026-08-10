import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * First-run setup, exercised through the HTTP routes.
 *
 * `setup.guard.test.ts` unit-tests `rejectIfAlreadySetUp` itself — including
 * the cases where there is no admin yet, no schema at all, or no reachable
 * database. This file covers the thing that test cannot: that the guard is
 * actually **mounted** on the endpoints that need it. A guard that exists and
 * is not wired up is worth nothing, and nothing else would notice.
 *
 * These endpoints are **unauthenticated** — they have to be, since there is no
 * account to sign in with before setup runs. That makes `rejectIfAlreadySetUp`
 * the only thing standing between a provisioned instance and an anonymous
 * caller re-running setup: `/complete` creates an admin account, so without the
 * guard anyone on the network could mint themselves one and take the store.
 *
 * Covered here as a guard, not as a provisioning flow: `/complete` opens real
 * database connections and rewrites config, which is not something a unit test
 * should be doing.
 */
const getUserByEmail = vi.fn();
const getAllUsers = vi.fn();
const query = vi.fn();

vi.mock('../../../services/database', () => ({
  default: { getAdapter: () => ({ getUserByEmail, getAllUsers, pool: { query } }) },
}));

const { default: app } = await import('../../../app');

/**
 * Whether the instance looks provisioned.
 *
 * `getSetupState` asks two different questions of the same pool — does the
 * `users` table exist, and are there any admin roles — and reads a differently
 * shaped row from each. A single mocked return value satisfies the first and
 * silently yields NaN for the second, which reads as "no admin" and waves the
 * guard through. Answering per query is what makes this test mean anything.
 */
function provisioned(yes: boolean) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('information_schema.tables')) return { rows: [{ exists: true }] };
    return { rows: [{ count: yes ? '1' : '0' }] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  provisioned(true);
});

describe('GET /api/setup/status', () => {
  it('is reachable without a session, since there may be no account yet', async () => {
    const response = await request(app).get('/api/setup/status');

    expect(response.status).toBe(200);
  });

  it('reports that a provisioned instance is set up', async () => {
    const response = await request(app).get('/api/setup/status');

    expect(response.body.data.hasAdminUser).toBe(true);
  });

  it('reports a fresh instance as needing setup', async () => {
    provisioned(false);

    const response = await request(app).get('/api/setup/status');

    expect(response.body.data.hasAdminUser).toBe(false);
  });

  it('does not leak account details, only whether one exists', async () => {
    // The status endpoint is public. Listing admin addresses here would hand an
    // attacker the usernames to spray against the login endpoint.
    const response = await request(app).get('/api/setup/status');

    expect(JSON.stringify(response.body)).not.toContain('admin@example.com');
  });
});

describe('rejectIfAlreadySetUp', () => {
  it('is mounted on /complete, which creates an admin account', async () => {
    // The endpoint needs no credentials — it cannot, on a fresh instance — so
    // the guard being wired here is the only thing stopping anyone who can
    // reach the port from minting themselves an admin on a live store.
    const response = await request(app)
      .post('/api/setup/complete')
      .send({ database: { adapter: 'sqlite' }, admin: { email: 'attacker@evil.test', password: 'Passw0rd!23' } });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/already been completed/i);
  });

  it('is mounted on /test-database too', async () => {
    // Otherwise it is an unauthenticated port scanner: point it at any host and
    // the error message reports whether a database answered.
    const response = await request(app)
      .post('/api/setup/test-database')
      .send({ adapter: 'postgres', host: '10.0.0.1', port: 5432, name: 'x', user: 'y', password: 'z' });

    expect(response.status).toBe(409);
  });

  it('lets a genuinely fresh instance through to validation', async () => {
    provisioned(false);

    const response = await request(app).post('/api/setup/test-database').send({});

    // Past the guard, so this is the schema's complaint rather than the
    // guard's — which is what distinguishes "not allowed" from "not valid".
    expect(response.status).not.toBe(409);
    expect(response.status).toBe(400);
  });
});
