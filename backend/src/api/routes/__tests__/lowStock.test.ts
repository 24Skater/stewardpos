import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const getSettings = vi.fn();
const getLowStockVariants = vi.fn();

vi.mock('../../../services/database', () => ({
  default: { getAdapter: () => ({ getUserByEmail, getSettings, getLowStockVariants }) },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

/** The threshold the route resolved and handed to the adapter. */
const askedFor = () => getLowStockVariants.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  });
  getSettings.mockResolvedValue({ config: {} });
  getLowStockVariants.mockResolvedValue([
    { id: 'v1', productName: 'Tea', stock: 2, threshold: 10 },
  ]);
});

describe('GET /api/products/low-stock', () => {
  it('lists what needs reordering', async () => {
    const response = await request(app)
      .get('/api/products/low-stock')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.total).toBe(1);
  });

  it('is not mistaken for a product id', async () => {
    // `/:id` is declared after this route. If the order were reversed, the
    // adapter would be asked for a product called "low-stock".
    await request(app).get('/api/products/low-stock').set('Authorization', `Bearer ${token()}`);

    expect(getLowStockVariants).toHaveBeenCalled();
  });

  it('falls back to the built-in default when the store has set none', async () => {
    await request(app).get('/api/products/low-stock').set('Authorization', `Bearer ${token()}`);

    expect(askedFor()).toBe(10);
  });

  it('uses the store default when one is configured', async () => {
    getSettings.mockResolvedValue({ config: { lowStockThreshold: 3 } });

    await request(app).get('/api/products/low-stock').set('Authorization', `Bearer ${token()}`);

    expect(askedFor()).toBe(3);
    expect(
      (await request(app).get('/api/products/low-stock').set('Authorization', `Bearer ${token()}`))
        .body.meta.defaultThreshold
    ).toBe(3);
  });

  it('honours a configured zero rather than treating it as unset', async () => {
    // "Only tell me when it is actually gone" is a real policy. Falsiness would
    // silently reinstate the default of 10 and flood the list.
    getSettings.mockResolvedValue({ config: { lowStockThreshold: 0 } });

    await request(app).get('/api/products/low-stock').set('Authorization', `Bearer ${token()}`);

    expect(askedFor()).toBe(0);
  });

  it('ignores a nonsensical stored threshold instead of passing it down', async () => {
    getSettings.mockResolvedValue({ config: { lowStockThreshold: -5 } });

    await request(app).get('/api/products/low-stock').set('Authorization', `Bearer ${token()}`);

    expect(askedFor()).toBe(10);
  });

  it('copes with a store that has no settings row at all', async () => {
    getSettings.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/products/low-stock')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(askedFor()).toBe(10);
  });

  it('needs inventory.read', async () => {
    getUserByEmail.mockResolvedValue({
      id: 'u1',
      email: 'admin@example.com',
      status: 'active',
      roleIds: ['r1'],
      roles: [
        { id: 'r1', name: 'Cashier', systemRole: 'standard', permissions: { inventory: { read: false } } },
      ],
    });

    expect(
      (await request(app).get('/api/products/low-stock').set('Authorization', `Bearer ${token()}`))
        .status
    ).toBe(403);
  });
});
