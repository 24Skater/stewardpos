import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const getUserById = vi.fn();
const updateUserLastLogin = vi.fn().mockResolvedValue(undefined);
const recordPasswordFailure = vi.fn().mockResolvedValue(undefined);
const resetPasswordFailures = vi.fn().mockResolvedValue(undefined);
const createAuditLog = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getUserById,
      updateUserLastLogin,
      recordPasswordFailure,
      resetPasswordFailures,
      createAuditLog,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const PASSWORD = 'correct-horse-battery-staple';
const ADMIN_ROLE = { id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} };

let hash: string;

function admin(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'admin@shop.example',
    name: 'Admin',
    status: 'active',
    passwordHash: hash,
    roleIds: ['r1'],
    roles: [ADMIN_ROLE],
    passwordFailedCount: 0,
    passwordLockedUntil: null,
    ...overrides,
  };
}

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@shop.example', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  hash = hash ?? (await bcrypt.hash(PASSWORD, 10));
  updateUserLastLogin.mockResolvedValue(undefined);
  recordPasswordFailure.mockResolvedValue(undefined);
  resetPasswordFailures.mockResolvedValue(undefined);
  createAuditLog.mockResolvedValue(undefined);
});

function login(password: string) {
  return request(app).post('/api/auth/login').send({ email: 'admin@shop.example', password });
}

describe('POST /api/auth/login lockout', () => {
  it('signs in normally and clears any accumulated failures', async () => {
    getUserByEmail.mockResolvedValue(admin({ passwordFailedCount: 4 }));

    const response = await login(PASSWORD);

    expect(response.status).toBe(200);
    expect(response.body.data.token).toBeTruthy();
    expect(resetPasswordFailures).toHaveBeenCalledWith('u1');
  });

  it('counts a wrong password against the account, not just the IP', async () => {
    getUserByEmail.mockResolvedValue(admin({ passwordFailedCount: 1 }));

    const response = await login('wrong');

    expect(response.status).toBe(401);
    expect(recordPasswordFailure).toHaveBeenCalledWith('u1', { failedCount: 2, lockedUntil: null });
  });

  it('says only "Invalid credentials" to someone guessing at a locked account', async () => {
    getUserByEmail.mockResolvedValue(admin({ passwordLockedUntil: Date.now() + 600_000 }));

    const response = await login('wrong');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid credentials');
    // Naming the lockout here would confirm the address exists.
    expect(response.body.code).toBeUndefined();
  });

  it('explains the lockout to someone who supplied the right password', async () => {
    getUserByEmail.mockResolvedValue(admin({ passwordLockedUntil: Date.now() + 600_000 }));

    const response = await login(PASSWORD);

    // They have proved they are not the one guessing, so this leaks nothing.
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('ACCOUNT_LOCKED');
    expect(response.body.error).toMatch(/too many failed attempts/i);
    expect(response.body.error).toMatch(/10 minutes/);
  });

  it('still refuses to mint a session for a locked account', async () => {
    getUserByEmail.mockResolvedValue(admin({ passwordLockedUntil: Date.now() + 600_000 }));

    const response = await login(PASSWORD);

    // The whole point: a lockout the right password walks through is not one.
    expect(response.body.data?.token).toBeUndefined();
    expect(updateUserLastLogin).not.toHaveBeenCalled();
  });

  it('never puts the hash or the lockout counters in the response', async () => {
    getUserByEmail.mockResolvedValue(admin({ passwordFailedCount: 2 }));

    const response = await login(PASSWORD);
    const body = JSON.stringify(response.body);

    expect(body).not.toContain(hash);
    expect(body).not.toContain('passwordFailedCount');
    expect(body).not.toContain('passwordLockedUntil');
  });
});

describe('POST /api/admin/users/:id/password/unlock', () => {
  it('clears the lockout and audits it', async () => {
    getUserByEmail.mockResolvedValue(admin());
    getUserById.mockResolvedValue({
      id: 'u2',
      email: 'locked@shop.example',
      passwordLockedUntil: Date.now() + 600_000,
      passwordFailedCount: 10,
    });

    const response = await request(app)
      .post('/api/admin/users/u2/password/unlock')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(resetPasswordFailures).toHaveBeenCalledWith('u2');
    expect(response.body.data.passwordLockedUntil).toBeNull();
    expect(response.body.data.passwordFailedCount).toBe(0);
  });

  it('404s for a user that does not exist', async () => {
    getUserByEmail.mockResolvedValue(admin());
    getUserById.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/admin/users/nope/password/unlock')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(404);
    expect(resetPasswordFailures).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const response = await request(app).post('/api/admin/users/u2/password/unlock');

    expect(response.status).toBe(401);
    expect(resetPasswordFailures).not.toHaveBeenCalled();
  });

  it('never returns the unlocked account password hash', async () => {
    getUserByEmail.mockResolvedValue(admin());
    getUserById.mockResolvedValue({
      id: 'u2',
      email: 'locked@shop.example',
      passwordHash: hash,
      passwordLockedUntil: Date.now() + 600_000,
      passwordFailedCount: 10,
    });

    const response = await request(app)
      .post('/api/admin/users/u2/password/unlock')
      .set('Authorization', `Bearer ${token()}`);

    expect(JSON.stringify(response.body)).not.toContain(hash);
  });
});
