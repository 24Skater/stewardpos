import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const getAllProducts = vi.fn();

vi.mock('../../../services/database', () => ({
  default: { getAdapter: () => ({ getUserByEmail, getAllProducts }) },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const TEA = {
  id: 'p-tea',
  name: 'Loose Leaf Tea',
  barcode: '5010',
  variants: [
    { id: 'v-small', size: 'Small', barcode: '5011', sku: 'TEA-S' },
    { id: 'v-large', size: 'Large', barcode: '5012', sku: 'TEA-L' },
  ],
};

function token(): string {
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
  getAllProducts.mockResolvedValue({ products: [TEA], total: 1 });
});

describe('GET /api/products', () => {
  it('returns everything when no paging is asked for', async () => {
    // Deliberately uncapped: a silent default would drop products off the end of
    // the register with nothing to show it had happened.
    await request(app).get('/api/products').set('Authorization', `Bearer ${token()}`);

    expect(getAllProducts).toHaveBeenCalledWith({});
  });

  it('passes a search term through', async () => {
    await request(app).get('/api/products?q=tea').set('Authorization', `Bearer ${token()}`);

    expect(getAllProducts).toHaveBeenCalledWith({ q: 'tea' });
  });

  it('passes a category filter through', async () => {
    await request(app).get('/api/products?category=Drinks').set('Authorization', `Bearer ${token()}`);

    expect(getAllProducts).toHaveBeenCalledWith({ category: 'Drinks' });
  });

  it('coerces paging parameters from the query string', async () => {
    await request(app)
      .get('/api/products?limit=10&offset=20')
      .set('Authorization', `Bearer ${token()}`);

    expect(getAllProducts).toHaveBeenCalledWith({ limit: 10, offset: 20 });
  });

  it('reports the total alongside the page', async () => {
    getAllProducts.mockResolvedValue({ products: [TEA], total: 87 });

    const response = await request(app)
      .get('/api/products?limit=1')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.total).toBe(87);
  });

  it('keeps `data` a bare array, so existing callers are unaffected', async () => {
    const response = await request(app).get('/api/products').set('Authorization', `Bearer ${token()}`);

    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('rejects a limit beyond the cap', async () => {
    const response = await request(app)
      .get('/api/products?limit=99999')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(400);
  });

  it('rejects a negative offset', async () => {
    expect(
      (await request(app).get('/api/products?offset=-1').set('Authorization', `Bearer ${token()}`))
        .status
    ).toBe(400);
  });
});

describe('GET /api/products/barcode/:code', () => {
  it('resolves the specific variant that was scanned', async () => {
    // Scanning the large size must add the large size, not whichever variant
    // happens to come first.
    const response = await request(app)
      .get('/api/products/barcode/5012')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.variant.id).toBe('v-large');
  });

  it('falls back to the first variant on a product-level barcode', async () => {
    const response = await request(app)
      .get('/api/products/barcode/5010')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.body.data.product.id).toBe('p-tea');
    expect(response.body.data.variant.id).toBe('v-small');
  });

  it('requires an exact match, not a substring', async () => {
    // The underlying search is a LIKE, so `501` would otherwise resolve to a
    // product barcoded `5010` and ring up the wrong item.
    const response = await request(app)
      .get('/api/products/barcode/501')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(404);
  });

  it('404s on an unknown code', async () => {
    getAllProducts.mockResolvedValue({ products: [], total: 0 });

    expect(
      (await request(app).get('/api/products/barcode/9999').set('Authorization', `Bearer ${token()}`))
        .status
    ).toBe(404);
  });

  it('is not mistaken for a product id lookup', async () => {
    await request(app).get('/api/products/barcode/5012').set('Authorization', `Bearer ${token()}`);

    // If the `/:id` route had matched first, this would have searched for a
    // product with the id "barcode".
    expect(getAllProducts).toHaveBeenCalledWith({ q: '5012' });
  });
});
