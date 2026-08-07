import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const createVariant = vi.fn();
const updateVariant = vi.fn();
const deleteVariant = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({ getUserByEmail, createVariant, updateVariant, deleteVariant, createAuditLog }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const VARIANT = { id: 'v1', size: 'Large', stock: 12, enabled: true };

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function actor(permissions: Record<string, unknown>) {
  return {
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Stock', systemRole: 'standard', permissions }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(
    actor({ inventory: { read: true, write: true, delete: true } })
  );
  createVariant.mockResolvedValue({ ...VARIANT });
  updateVariant.mockResolvedValue({ ...VARIANT, stock: 30 });
  deleteVariant.mockResolvedValue('deleted');
  createAuditLog.mockResolvedValue({});
});

describe('POST /api/products/:id/variants', () => {
  it('adds a variant to an existing product', async () => {
    const response = await request(app)
      .post('/api/products/p1/variants')
      .set('Authorization', `Bearer ${token()}`)
      .send({ size: 'Large', stock: 12 });

    expect(response.status).toBe(201);
    expect(createVariant).toHaveBeenCalledWith('p1', expect.objectContaining({ size: 'Large', stock: 12 }));
  });

  it('404s when the product does not exist', async () => {
    createVariant.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/products/nope/variants')
      .set('Authorization', `Bearer ${token()}`)
      .send({ stock: 1 });

    expect(response.status).toBe(404);
  });

  it('rejects negative stock', async () => {
    const response = await request(app)
      .post('/api/products/p1/variants')
      .set('Authorization', `Bearer ${token()}`)
      .send({ stock: -5 });

    expect(response.status).toBe(400);
    expect(createVariant).not.toHaveBeenCalled();
  });

  it('needs inventory.write', async () => {
    getUserByEmail.mockResolvedValue(actor({ inventory: { read: true, write: false } }));

    const response = await request(app)
      .post('/api/products/p1/variants')
      .set('Authorization', `Bearer ${token()}`)
      .send({ stock: 1 });

    expect(response.status).toBe(403);
  });
});

describe('PUT /api/products/:id/variants/:variantId', () => {
  it('updates only what was sent', async () => {
    // The adapter COALESCEs the rest, so a stock correction must not blank the
    // size or the barcode.
    const response = await request(app)
      .put('/api/products/p1/variants/v1')
      .set('Authorization', `Bearer ${token()}`)
      .send({ stock: 30 });

    expect(response.status).toBe(200);
    expect(updateVariant).toHaveBeenCalledWith('p1', 'v1', { stock: 30 });
  });

  it('can disable a variant', async () => {
    // `false` is a real value here, not an absence — it has to survive.
    updateVariant.mockResolvedValue({ ...VARIANT, enabled: false });

    await request(app)
      .put('/api/products/p1/variants/v1')
      .set('Authorization', `Bearer ${token()}`)
      .send({ enabled: false });

    expect(updateVariant).toHaveBeenCalledWith('p1', 'v1', { enabled: false });
  });

  it('404s for a variant that is not on that product', async () => {
    updateVariant.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/products/p1/variants/other')
      .set('Authorization', `Bearer ${token()}`)
      .send({ stock: 1 });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/products/:id/variants/:variantId', () => {
  it('removes a variant', async () => {
    const response = await request(app)
      .delete('/api/products/p1/variants/v1')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
  });

  it('refuses to remove the last one', async () => {
    // A product with no variants cannot be sold and there is no "unsellable"
    // state, so this would strand it in the catalog.
    deleteVariant.mockResolvedValue('last');

    const response = await request(app)
      .delete('/api/products/p1/variants/v1')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/at least one variant/);
  });

  it('404s for an unknown variant', async () => {
    deleteVariant.mockResolvedValue('not_found');

    expect(
      (await request(app).delete('/api/products/p1/variants/x').set('Authorization', `Bearer ${token()}`))
        .status
    ).toBe(404);
  });

  it('needs inventory.delete, not merely write', async () => {
    getUserByEmail.mockResolvedValue(
      actor({ inventory: { read: true, write: true, delete: false } })
    );

    const response = await request(app)
      .delete('/api/products/p1/variants/v1')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(403);
    expect(deleteVariant).not.toHaveBeenCalled();
  });
});
