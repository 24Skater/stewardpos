import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

/**
 * API key management.
 *
 * Two properties matter more than the CRUD: the plaintext key is shown exactly
 * once and never stored, and a key cannot manage keys. The second is what stops
 * one compromised key becoming permanent, self-renewing access — an admin-scoped
 * key authenticates as an admin, so without the guard it could mint successors
 * and revoke whatever an operator was watching.
 */
const getUserByEmail = vi.fn();
const getAllApiKeys = vi.fn();
const getApiKeyById = vi.fn();
const createApiKey = vi.fn();
const updateApiKey = vi.fn();
const deleteApiKey = vi.fn();
const getApiKeyByPrefix = vi.fn();
const updateApiKeyLastUsed = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getAllApiKeys,
      getApiKeyById,
      createApiKey,
      updateApiKey,
      deleteApiKey,
      getApiKeyByPrefix,
      updateApiKeyLastUsed,
      createAuditLog,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const KEY = { id: 'k1', name: 'Reporting', keyPrefix: 'sp_abc123', scopes: ['read'] };
const BASE = '/api/admin/api-keys';

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function person(systemRole = 'admin') {
  return {
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole, permissions: {} }],
  };
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(person());
  getAllApiKeys.mockResolvedValue([KEY]);
  getApiKeyById.mockResolvedValue(KEY);
  createApiKey.mockImplementation(async (data: Record<string, unknown>) => ({ id: 'k2', ...data }));
  updateApiKey.mockResolvedValue(KEY);
  deleteApiKey.mockResolvedValue(true);
  updateApiKeyLastUsed.mockResolvedValue(undefined);
  createAuditLog.mockResolvedValue({});
});

describe('POST /api/admin/api-keys', () => {
  it('returns the plaintext key exactly once, on creation', async () => {
    const response = await request(app).post(BASE).set(auth()).send({ name: 'Reporting' });

    expect(response.status).toBe(201);
    expect(response.body.data.key).toBeTruthy();
    expect(response.body.message).toMatch(/cannot be retrieved later/i);
  });

  it('stores a hash, never the key itself', async () => {
    // A stored key is a stored credential: anyone who can read the table can
    // authenticate as it.
    const response = await request(app).post(BASE).set(auth()).send({ name: 'Reporting' });

    const stored = createApiKey.mock.calls[0][0];
    expect(stored.keyHash).toBeTruthy();
    expect(stored.keyHash).not.toBe(response.body.data.key);
    expect(JSON.stringify(stored)).not.toContain(response.body.data.key);
  });

  it('stores a hash that actually verifies against the issued key', async () => {
    const response = await request(app).post(BASE).set(auth()).send({ name: 'Reporting' });

    const { keyHash } = createApiKey.mock.calls[0][0];
    expect(await bcrypt.compare(response.body.data.key, String(keyHash))).toBe(true);
  });

  it('keeps a prefix, so a key can be identified without being known', async () => {
    const response = await request(app).post(BASE).set(auth()).send({ name: 'Reporting' });

    const { keyPrefix } = createApiKey.mock.calls[0][0];
    expect(String(response.body.data.key)).toContain(String(keyPrefix));
  });

  it('defaults to read-only rather than to full access', async () => {
    await request(app).post(BASE).set(auth()).send({ name: 'Reporting' });

    expect(createApiKey.mock.calls[0][0].scopes).toEqual(['read']);
  });

  it('requires a name', async () => {
    expect((await request(app).post(BASE).set(auth()).send({})).status).toBe(400);
  });

  it('rejects an unknown scope', async () => {
    const response = await request(app)
      .post(BASE)
      .set(auth())
      .send({ name: 'Reporting', scopes: ['superuser'] });

    expect(response.status).toBe(400);
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it('records who created it', async () => {
    await request(app).post(BASE).set(auth()).send({ name: 'Reporting' });

    expect(createApiKey.mock.calls[0][0].createdBy).toBe('u1');
  });
});

describe('reading keys', () => {
  it('lists them', async () => {
    expect((await request(app).get(BASE).set(auth())).body.data).toHaveLength(1);
  });

  it('never returns the key or its hash on a read', async () => {
    getApiKeyById.mockResolvedValue({ ...KEY, keyHash: '$2a$10$notarealhash' });

    const response = await request(app).get(`${BASE}/k1`).set(auth());

    expect(JSON.stringify(response.body)).not.toContain('notarealhash');
  });

  it('404s for one that does not exist', async () => {
    getApiKeyById.mockResolvedValue(null);

    expect((await request(app).get(`${BASE}/nope`).set(auth())).status).toBe(404);
  });
});

describe('revocation', () => {
  it('deletes a key', async () => {
    expect((await request(app).delete(`${BASE}/k1`).set(auth())).status).toBe(200);
  });

  it('404s when there is nothing to revoke', async () => {
    deleteApiKey.mockResolvedValue(false);

    expect((await request(app).delete(`${BASE}/k1`).set(auth())).status).toBe(404);
  });
});

describe('who may manage keys', () => {
  it('refuses a non-admin', async () => {
    getUserByEmail.mockResolvedValue(person('standard'));

    expect((await request(app).get(BASE).set(auth())).status).toBe(403);
  });

  it('refuses an API key, even an admin-scoped one', async () => {
    // The whole point: compromise of one key must not become self-renewing.
    getApiKeyByPrefix.mockResolvedValue({
      id: 'k9',
      name: 'compromised',
      keyPrefix: 'sp_evil123',
      keyHash: await bcrypt.hash('sp_evil123_secret', 4),
      scopes: ['admin'],
      status: 'active',
      expiresAt: null,
    });

    const response = await request(app).get(BASE).set('X-API-Key', 'sp_evil123_secret');

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/cannot manage/i);
  });

  it('refuses an anonymous caller', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });
});

describe('the published reference', () => {
  it('names the header that actually authenticates a key', async () => {
    // It said `Authorization: Bearer`, which is how a *session* authenticates —
    // the middleware reads keys from `X-API-Key` and parses a Bearer value as a
    // JWT. An integrator following the reference got a 401 and no indication
    // that the header was the problem. This is what stops it drifting back.
    const response = await request(app).get(`${BASE}/docs/reference`).set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data.authentication.header).toBe('X-API-Key');
    expect(response.body.data.authentication.example).toMatch(/^X-API-Key:/);
  });

  it('does not promise a per-key rate limit, because there is not one', async () => {
    // The limiter in front of /api keys on the caller's address and never sees
    // which key was presented; sizing retries against a per-key budget would be
    // sizing them against a limit that does not exist.
    const response = await request(app).get(`${BASE}/docs/reference`).set(auth());

    expect(response.body.data.rateLimiting.description).not.toMatch(/per API key/i);
    expect(response.body.data.rateLimiting.description).toMatch(/per client address/i);
  });

  it('lists the scopes a key can be granted', async () => {
    const response = await request(app).get(`${BASE}/docs/reference`).set(auth());

    expect(Object.keys(response.body.data.scopes).sort()).toEqual([
      'admin',
      'delete',
      'read',
      'write',
    ]);
  });
});
