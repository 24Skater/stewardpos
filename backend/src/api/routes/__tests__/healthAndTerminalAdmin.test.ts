import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Health checks and the admin-only terminal endpoints.
 *
 * Health is what the container orchestrator polls, and what the E2E job waits
 * on before running. It has to be reachable **without credentials** — a health
 * check that requires a token cannot tell a load balancer anything — and it
 * must not leak anything about the deployment beyond liveness.
 *
 * The reader and connection-test endpoints are admin-only through a manual
 * check rather than `requirePermission`, which is easy to drop when refactoring
 * and would expose the payment configuration to any signed-in cashier.
 */
const getUserByEmail = vi.fn();
const getSettings = vi.fn();
const createTerminalTransaction = vi.fn();
const updateTerminalTransactionByChargeId = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getSettings,
      createTerminalTransaction,
      updateTerminalTransactionByChargeId,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function person(systemRole: string) {
  return {
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Role', systemRole, permissions: { orders: { read: true, write: true } } }],
  };
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(person('admin'));
  getSettings.mockResolvedValue({ config: {} });
  createTerminalTransaction.mockResolvedValue({ id: 't1' });
  updateTerminalTransactionByChargeId.mockResolvedValue(undefined);
});

describe('GET /api/health', () => {
  it('answers without credentials', async () => {
    // A health check that needs a token tells a load balancer nothing.
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
  });

  it('reports uptime, which is how a restart loop is spotted', async () => {
    const response = await request(app).get('/api/health');

    expect(typeof response.body.uptime).toBe('number');
  });

  it('reports memory in whole megabytes', async () => {
    const response = await request(app).get('/api/health');

    expect(Number.isInteger(response.body.memory.used)).toBe(true);
    expect(response.body.memory.total).toBeGreaterThan(0);
  });

  it('leaks nothing beyond liveness', async () => {
    // It is unauthenticated and typically exposed, so anything identifying the
    // host, the database, or the software version does not belong in it.
    const response = await request(app).get('/api/health');

    const body = JSON.stringify(response.body).toLowerCase();
    for (const leak of ['password', 'secret', 'token', 'connection', 'hostname']) {
      expect(body, `health response mentions ${leak}`).not.toContain(leak);
    }
  });
});

describe('GET /api/health/db', () => {
  it('answers without credentials', async () => {
    const response = await request(app).get('/api/health/db');

    expect(response.status).toBe(200);
  });

  it('names the adapter without revealing where it lives', async () => {
    const response = await request(app).get('/api/health/db');

    expect(response.body.adapter).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toMatch(/password|@|:\d{4}/);
  });
});

describe('GET /api/terminal/readers', () => {
  it('lists readers for an admin', async () => {
    const response = await request(app).get('/api/terminal/readers').set(auth());

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('refuses a non-admin, even one who may take orders', async () => {
    // Guarded by a hand-written check rather than `requirePermission`, so it is
    // easy to drop in a refactor — and dropping it would show the payment
    // configuration to any signed-in cashier.
    getUserByEmail.mockResolvedValue(person('standard'));

    expect((await request(app).get('/api/terminal/readers').set(auth())).status).toBeGreaterThanOrEqual(
      401
    );
  });

  it('refuses an anonymous caller', async () => {
    expect((await request(app).get('/api/terminal/readers')).status).toBe(401);
  });
});

describe('POST /api/terminal/test', () => {
  it('reports whether the configured provider answers', async () => {
    const response = await request(app).post('/api/terminal/test').set(auth());

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success');
  });

  it('is admin-only', async () => {
    getUserByEmail.mockResolvedValue(person('standard'));

    expect((await request(app).post('/api/terminal/test').set(auth())).status).toBeGreaterThanOrEqual(
      401
    );
  });
});

describe('POST /api/terminal/cancel/:chargeId', () => {
  it('cancels and records the cancellation', async () => {
    const response = await request(app).post('/api/terminal/cancel/ch_1').set(auth());

    expect(response.status).toBe(200);
    expect(updateTerminalTransactionByChargeId).toHaveBeenCalledWith('ch_1', {
      status: 'cancelled',
    });
  });
});
