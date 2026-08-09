import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Session, refresh, and logout.
 *
 * `auth.test.ts` covers signing in. This covers what happens afterwards, and
 * the property that matters most across all of it: the password hash must never
 * reach the client. `/session` returns the user record it just loaded from the
 * database, which is the shape most likely to carry the hash along by accident.
 */
const getUserByEmail = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: { getAdapter: () => ({ getUserByEmail, createAuditLog }) },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

function token(overrides: Record<string, unknown> = {}, secret = config.jwt.secret): string {
  return jwt.sign(
    { id: 'u1', email: 'cashier@example.com', roleIds: ['r1'], ...overrides },
    secret,
    { expiresIn: '1h' }
  );
}

function person(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'cashier@example.com',
    name: 'Ada',
    status: 'active',
    roleIds: ['r1'],
    passwordHash: '$2a$10$averyrealisticlookinghashvalue',
    roles: [{ id: 'r1', name: 'Cashier', systemRole: 'standard', permissions: {} }],
    ...overrides,
  };
}

const auth = (t = token()) => ({ Authorization: `Bearer ${t}` });

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(person());
  createAuditLog.mockResolvedValue({});
});

describe('GET /api/auth/session', () => {
  it('returns the signed-in user', async () => {
    const response = await request(app).get('/api/auth/session').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe('cashier@example.com');
  });

  it('never returns the password hash', async () => {
    // The handler spreads a database record, which is exactly where a hash
    // gets carried along without anyone meaning to.
    const response = await request(app).get('/api/auth/session').set(auth());

    expect(JSON.stringify(response.body)).not.toContain('averyrealisticlookinghash');
  });

  it('returns the roles, which is what the UI gates on', async () => {
    const response = await request(app).get('/api/auth/session').set(auth());

    expect(response.body.data.user.roles).toHaveLength(1);
  });

  it('refuses an anonymous caller', async () => {
    expect((await request(app).get('/api/auth/session')).status).toBe(401);
  });

  it('refuses a token signed with the wrong secret', async () => {
    expect(
      (await request(app).get('/api/auth/session').set(auth(token({}, 'not-the-real-secret-at-all')))).status
    ).toBe(401);
  });

  it('refuses an expired token', async () => {
    const expired = jwt.sign({ id: 'u1', email: 'cashier@example.com' }, config.jwt.secret, {
      expiresIn: '-1h',
    });

    expect((await request(app).get('/api/auth/session').set(auth(expired))).status).toBe(401);
  });

  it('refuses a user who has been deleted since their token was issued', async () => {
    // The token is still cryptographically valid; the account is gone. Loading
    // the user on every request is what makes that take effect immediately.
    getUserByEmail.mockResolvedValue(null);

    expect((await request(app).get('/api/auth/session').set(auth())).status).toBe(401);
  });

  it('refuses a user who has been suspended since their token was issued', async () => {
    getUserByEmail.mockResolvedValue(person({ status: 'suspended' }));

    expect((await request(app).get('/api/auth/session').set(auth())).status).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  it('issues a new token', async () => {
    const response = await request(app).post('/api/auth/refresh').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data.token).toBeTruthy();
  });

  it('issues one that actually verifies', async () => {
    const response = await request(app).post('/api/auth/refresh').set(auth());

    expect(() => jwt.verify(response.body.data.token, config.jwt.secret)).not.toThrow();
  });

  it('keeps the same identity', async () => {
    const response = await request(app).post('/api/auth/refresh').set(auth());

    const claims = jwt.decode(response.body.data.token) as { email: string };
    expect(claims.email).toBe('cashier@example.com');
  });

  it('will not refresh for a suspended account', async () => {
    // Otherwise a suspension could be outrun indefinitely by refreshing.
    getUserByEmail.mockResolvedValue(person({ status: 'suspended' }));

    expect((await request(app).post('/api/auth/refresh').set(auth())).status).toBe(401);
  });

  it('refuses an anonymous caller', async () => {
    expect((await request(app).post('/api/auth/refresh')).status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('succeeds for a signed-in user', async () => {
    expect((await request(app).post('/api/auth/logout').set(auth())).status).toBe(200);
  });

  it('refuses an anonymous caller', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(401);
  });
});
