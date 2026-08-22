import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

// The auth routes reach the database through this service. Stubbing it keeps these
// as route tests — no Postgres, no SQLite native bindings, no seeded fixtures.
const getUserByEmail = vi.fn();
const updateUserLastLogin = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({ getUserByEmail, updateUserLastLogin }),
  },
}));

const { default: app } = await import('../../../app');

const KNOWN_PASSWORD = 'correct-horse-battery-staple';

async function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    passwordHash: await bcrypt.hash(KNOWN_PASSWORD, 4),
    name: 'Test User',
    status: 'active',
    // Back-office role by default: this file exercises the password form
    // itself, not the till-vs-back-office split (see loginPolicy.test.ts for
    // that). A till-only or roleless user would now be correctly refused with
    // 403, which would make every "issues a token" case here fail for the
    // wrong reason.
    roleIds: ['role-admin'],
    roles: [{ id: 'role-admin', name: 'admin', systemRole: 'admin' }],
    ...overrides,
  };
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserByEmail.mockResolvedValue(null);
  });

  it('rejects a malformed email address', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'invalid', password: 'password' });

    expect(response.status).toBe(400);
  });

  it('rejects a missing password', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com' });

    expect(response.status).toBe(400);
  });

  it('returns 401 when no such user exists', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrong' });

    expect(response.status).toBe(401);
  });

  it('returns 401 when the password does not match', async () => {
    getUserByEmail.mockResolvedValue(await activeUser());

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'not-the-password' });

    expect(response.status).toBe(401);
  });

  it('issues a token for valid credentials', async () => {
    getUserByEmail.mockResolvedValue(await activeUser());

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: KNOWN_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.token).toBeTypeOf('string');
    expect(response.body.data.user.email).toBe('test@example.com');
  });

  it('never returns the password hash to the client', async () => {
    getUserByEmail.mockResolvedValue(await activeUser());

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: KNOWN_PASSWORD });

    expect(JSON.stringify(response.body)).not.toContain('$2');
  });

  it('refuses a user whose account is not active', async () => {
    getUserByEmail.mockResolvedValue(await activeUser({ status: 'disabled' }));

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: KNOWN_PASSWORD });

    expect(response.status).toBe(401);
  });

  it('fails closed when the stored password hash is not a string', async () => {
    getUserByEmail.mockResolvedValue(await activeUser({ passwordHash: null }));

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: KNOWN_PASSWORD });

    expect(response.status).toBe(401);
  });
});

describe('GET /api/auth/session', () => {
  it('returns 401 without a token', async () => {
    const response = await request(app).get('/api/auth/session');

    expect(response.status).toBe(401);
  });

  it('returns 401 with an invalid token', async () => {
    const response = await request(app)
      .get('/api/auth/session')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
  });
});
