import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const getProductById = vi.fn();
const getSettings = vi.fn();
const createOrder = vi.fn();
const createAuditLog = vi.fn();
const getDiscountTypeById = vi.fn();
const getPromoCodeById = vi.fn();
const getPromoCodeByCode = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getProductById,
      getSettings,
      createOrder,
      createAuditLog,
      getDiscountTypeById,
      getPromoCodeById,
      getPromoCodeByCode,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const TEA = {
  id: 'p-tea',
  name: 'Loose Leaf Tea',
  basePrice: 3.5,
  variants: [{ id: 'v-large', size: 'Large', priceDelta: 1.5, stock: 20, enabled: true }],
};

function tokenFor(): string {
  return jwt.sign({ id: 'u1', email: 'staff@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function actor(permissions: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'staff@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Standard', systemRole: 'standard', permissions }],
  };
}

const CART = {
  items: [{ productId: 'p-tea', variantId: 'v-large', quantity: 4 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(actor({ orders: { read: true, write: true } }));
  getProductById.mockResolvedValue(TEA);
  getSettings.mockResolvedValue({ taxRateDefault: 0.1 });
  createAuditLog.mockResolvedValue({});
  getDiscountTypeById.mockResolvedValue({
    id: 'd-senior',
    name: 'Senior Discount',
    discountType: 'percentage',
    discountValue: 10,
    isActive: true,
    showInPos: true,
  });
  // Echo what the route asked to store, so the test can compare the two.
  createOrder.mockImplementation(async (order: Record<string, unknown>) => ({
    id: 'o1',
    createdAt: Date.now(),
    ...order,
  }));
});

describe('POST /api/orders/quote', () => {
  it('prices from the catalog', async () => {
    // 4 x (3.50 + 1.50) = 20.00, +10% tax = 22.00
    const response = await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(CART);

    expect(response.status).toBe(200);
    expect(response.body.data.subtotal).toBe(20);
    expect(response.body.data.taxTotal).toBe(2);
    expect(response.body.data.total).toBe(22);
  });

  it('creates nothing', async () => {
    await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(CART);

    expect(createOrder).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('reports the discounts it actually honoured', async () => {
    const response = await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...CART, appliedDiscounts: [{ source: 'quick_discount', id: 'd-senior' }] });

    // 20.00 - 10% = 18.00 taxable, +10% tax = 19.80
    expect(response.body.data.discountTotal).toBe(2);
    expect(response.body.data.total).toBe(19.8);
    expect(response.body.data.appliedDiscounts[0].name).toBe('Senior Discount');
    expect(response.body.data.appliedDiscounts[0].amount).toBe(2);
  });

  it('surfaces a rejected discount as a 400, before the customer is charged', async () => {
    getDiscountTypeById.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...CART, appliedDiscounts: [{ source: 'quick_discount', id: 'gone' }] });

    expect(response.status).toBe(400);
  });

  it('rejects an out-of-stock cart without creating anything', async () => {
    const response = await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ items: [{ productId: 'p-tea', variantId: 'v-large', quantity: 999 }] });

    expect(response.status).toBe(400);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('needs orders.write, not merely a session', async () => {
    getUserByEmail.mockResolvedValue(actor({ orders: { read: true, write: false } }));

    const response = await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(CART);

    expect(response.status).toBe(403);
  });
});

describe('quote and sale agree', () => {
  /**
   * The property the shared `priceCart` exists to guarantee. If these can
   * diverge, the register charges a card one amount and records another.
   */
  const scenarios = [
    { label: 'plain cart', body: CART },
    {
      label: 'with a catalog discount',
      body: { ...CART, appliedDiscounts: [{ source: 'quick_discount', id: 'd-senior' }] },
    },
  ];

  for (const { label, body } of scenarios) {
    it(`match on totals — ${label}`, async () => {
      const quote = await request(app)
        .post('/api/orders/quote')
        .set('Authorization', `Bearer ${tokenFor()}`)
        .send(body);

      const sale = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${tokenFor()}`)
        .send({
          ...body,
          // Deliberately wrong: the sale must ignore these exactly as the quote does.
          subtotal: 1,
          discountTotal: 999,
          taxTotal: 1,
          total: 1,
          paymentMethod: 'Cash',
        });

      expect(sale.status).toBe(201);
      for (const field of ['subtotal', 'discountTotal', 'taxTotal', 'total'] as const) {
        expect(sale.body.data[field]).toBe(quote.body.data[field]);
      }
    });
  }
});
