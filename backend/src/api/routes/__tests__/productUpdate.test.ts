import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const getProductById = vi.fn();
const updateProduct = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({ getUserByEmail, getProductById, updateProduct, createAuditLog }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const STORED = {
  id: 'p1',
  name: 'Loose Leaf Tea',
  description: 'Single-origin Assam',
  category: 'Drinks',
  basePrice: 3.5,
  barcode: '5012345678900',
  image: '/uploads/tea.png',
  variants: [],
};

function adminToken(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  });
  getProductById.mockResolvedValue(STORED);
  createAuditLog.mockResolvedValue({});
  updateProduct.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
    ...STORED,
    ...patch,
  }));
});

describe('PUT /api/products/:id', () => {
  it('accepts a partial update', async () => {
    // Every field on the update schema is optional, so this is a supported
    // request - it used to fail outright on the NOT NULL `name` column.
    const response = await request(app)
      .put('/api/products/p1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ basePrice: 4.25 });

    expect(response.status).toBe(200);
  });

  it('passes only the submitted fields to the adapter', async () => {
    await request(app)
      .put('/api/products/p1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ basePrice: 4.25 });

    // The adapter COALESCEs the rest against the stored row; anything it is
    // handed as an explicit null would overwrite. Sending only what changed is
    // what keeps the description, category, image and barcode alive.
    const patch = updateProduct.mock.calls[0][1];
    expect(patch).toEqual({ basePrice: 4.25 });
    expect(patch).not.toHaveProperty('description');
    expect(patch).not.toHaveProperty('barcode');
  });

  it('records the prior values on the audit trail', async () => {
    await request(app)
      .put('/api/products/p1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ basePrice: 4.25 });

    const entry = createAuditLog.mock.calls[0][0];
    expect(entry.action).toBe('update');
    expect(entry.entity).toBe('product');
    expect(entry.before.basePrice).toBe(3.5);
    expect(entry.after.basePrice).toBe(4.25);
  });

  it('rejects a body that fails validation', async () => {
    const response = await request(app)
      .put('/api/products/p1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ basePrice: -1 });

    expect(response.status).toBe(400);
    expect(updateProduct).not.toHaveBeenCalled();
  });
});
