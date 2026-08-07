import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

const getUserByEmail = vi.fn();
const getApiKeyByPrefix = vi.fn();
const updateApiKeyLastUsed = vi.fn();
const getAllProducts = vi.fn();
const deleteProduct = vi.fn();
const createProduct = vi.fn();
const getProductById = vi.fn();
const createAuditLog = vi.fn();
const getAllApiKeys = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getApiKeyByPrefix,
      updateApiKeyLastUsed,
      getAllProducts,
      deleteProduct,
      createProduct,
      getProductById,
      createAuditLog,
      getAllApiKeys,
    }),
  },
}));

const { default: app } = await import('../../../app');

const KEY = 'spk_abcd1234_' + 'f'.repeat(64);
const PREFIX = 'spk_abcd1234';
// Cost 4 keeps the suite fast; the production path hashes at 10.
const HASH = bcrypt.hashSync(KEY, 4);

function keyRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    name: 'Integration',
    keyPrefix: PREFIX,
    keyHash: HASH,
    scopes: ['read'],
    isActive: true,
    expiresAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getApiKeyByPrefix.mockResolvedValue(keyRecord());
  updateApiKeyLastUsed.mockResolvedValue(undefined);
  // The catalog list returns a page plus a total, not a bare array.
  getAllProducts.mockResolvedValue({ products: [], total: 0 });
  getAllApiKeys.mockResolvedValue([]);
  deleteProduct.mockResolvedValue(true);
  createProduct.mockResolvedValue({ id: 'p1', name: 'New' });
  getProductById.mockResolvedValue({ id: 'p1', name: 'Existing', basePrice: 1, variants: [] });
  createAuditLog.mockResolvedValue({});
});

describe('X-API-Key authentication', () => {
  it('accepts a valid key', async () => {
    const response = await request(app).get('/api/products').set('X-API-Key', KEY);

    expect(response.status).toBe(200);
    expect(getApiKeyByPrefix).toHaveBeenCalledWith(PREFIX);
  });

  it('records that the key was used', async () => {
    await request(app).get('/api/products').set('X-API-Key', KEY);

    expect(updateApiKeyLastUsed).toHaveBeenCalledWith('key-1');
  });

  it('rejects an unknown prefix', async () => {
    getApiKeyByPrefix.mockResolvedValue(null);

    expect((await request(app).get('/api/products').set('X-API-Key', KEY)).status).toBe(401);
  });

  it('rejects a key whose secret does not match its prefix', async () => {
    // The prefix is guessable from any leaked key; the secret is what proves it.
    const forged = `${PREFIX}_${'0'.repeat(64)}`;

    expect((await request(app).get('/api/products').set('X-API-Key', forged)).status).toBe(401);
  });

  it('rejects a revoked key', async () => {
    getApiKeyByPrefix.mockResolvedValue(keyRecord({ isActive: false }));

    expect((await request(app).get('/api/products').set('X-API-Key', KEY)).status).toBe(401);
  });

  it('rejects an expired key', async () => {
    getApiKeyByPrefix.mockResolvedValue(keyRecord({ expiresAt: 1_000 }));

    expect((await request(app).get('/api/products').set('X-API-Key', KEY)).status).toBe(401);
  });

  it('does not fall through to anonymous when the key is bad', async () => {
    // A typo in a key should say "your key is wrong", not produce a confusing
    // failure from somewhere further along.
    getApiKeyByPrefix.mockResolvedValue(null);

    const response = await request(app).get('/api/products').set('X-API-Key', 'nonsense');

    expect(response.status).toBe(401);
    expect(getAllProducts).not.toHaveBeenCalled();
  });
});

describe('scopes', () => {
  it('read alone cannot write', async () => {
    const response = await request(app)
      .post('/api/products')
      .set('X-API-Key', KEY)
      .send({ name: 'New', category: 'Drinks', basePrice: 1 });

    expect(response.status).toBe(403);
    expect(createProduct).not.toHaveBeenCalled();
  });

  it('write can create but not delete', async () => {
    getApiKeyByPrefix.mockResolvedValue(keyRecord({ scopes: ['read', 'write'] }));

    const created = await request(app)
      .post('/api/products')
      .set('X-API-Key', KEY)
      .send({ name: 'New', category: 'Drinks', basePrice: 1 });
    expect(created.status).toBe(201);

    const deleted = await request(app).delete('/api/products/p1').set('X-API-Key', KEY);
    expect(deleted.status).toBe(403);
    expect(deleteProduct).not.toHaveBeenCalled();
  });

  it('delete can delete', async () => {
    getApiKeyByPrefix.mockResolvedValue(keyRecord({ scopes: ['read', 'write', 'delete'] }));

    expect((await request(app).delete('/api/products/p1').set('X-API-Key', KEY)).status).toBe(200);
  });

  it('admin reaches what a per-resource grant would not', async () => {
    getApiKeyByPrefix.mockResolvedValue(keyRecord({ scopes: ['admin'] }));

    expect((await request(app).get('/api/products').set('X-API-Key', KEY)).status).toBe(200);
  });
});

describe('keys cannot manage keys', () => {
  it('refuses an admin-scoped key on the key-management routes', async () => {
    // Otherwise one compromised key becomes self-renewing access: mint a
    // successor, widen its scopes, revoke the ones being watched.
    getApiKeyByPrefix.mockResolvedValue(keyRecord({ scopes: ['admin'] }));

    const response = await request(app).get('/api/admin/api-keys').set('X-API-Key', KEY);

    expect(response.status).toBe(403);
    expect(getAllApiKeys).not.toHaveBeenCalled();
  });
});
