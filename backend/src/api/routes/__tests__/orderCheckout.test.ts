import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Route-level checkout behaviour: how `POST /api/orders` composes pricing,
 * discounts, tender, and change. The arithmetic itself is unit-tested in the
 * services; these cover the wiring, which is where the mistakes have been.
 */
const getUserByEmail = vi.fn();
const getProductById = vi.fn();
const getSettings = vi.fn();
const createOrder = vi.fn();
const createAuditLog = vi.fn();
const getDiscountTypeById = vi.fn();
const logDiscountUsage = vi.fn();
const incrementPromoCodeUsage = vi.fn();
const getPromoCodeById = vi.fn();
const updateTerminalTransactionByChargeId = vi.fn();
const getAllOrders = vi.fn();
const getOrderById = vi.fn();
const getOrdersByCustomerEmail = vi.fn();

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
      logDiscountUsage,
      incrementPromoCodeUsage,
      updateTerminalTransactionByChargeId,
      getAllOrders,
      getOrderById,
      getOrdersByCustomerEmail,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const TEA = {
  id: 'p-tea',
  name: 'Tea',
  basePrice: 5,
  variants: [{ id: 'v1', stock: 100, enabled: true }],
};

const CART = { items: [{ productId: 'p-tea', variantId: 'v1', quantity: 4 }] };

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

/** What the route asked the adapter to store. */
const stored = () => createOrder.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  });
  getProductById.mockResolvedValue(TEA);
  getSettings.mockResolvedValue({ taxRateDefault: 0 });
  createAuditLog.mockResolvedValue({});
  logDiscountUsage.mockResolvedValue({});
  incrementPromoCodeUsage.mockResolvedValue(undefined);
  updateTerminalTransactionByChargeId.mockResolvedValue(undefined);
  getAllOrders.mockResolvedValue([{ id: 'o1' }]);
  getOrderById.mockResolvedValue({ id: 'o1', total: 20, payments: [] });
  getOrdersByCustomerEmail.mockResolvedValue([{ id: 'o1' }]);
  createOrder.mockImplementation(async (order: Record<string, unknown>) => ({
    id: 'o1',
    createdAt: Date.now(),
    ...order,
  }));
});

describe('tender', () => {
  it('turns a single payment method into one payment covering the sale', async () => {
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .send({ ...CART, paymentMethod: 'Cash' });

    expect(stored().payments).toEqual([{ method: 'cash', amount: 20 }]);
    expect(stored().paymentMethod).toBe('Cash');
  });

  it('records a split and summarises it as Split', async () => {
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        ...CART,
        paymentMethod: 'Cash',
        payments: [
          { method: 'cash', amount: 12 },
          { method: 'card', amount: 8 },
        ],
      });

    expect(stored().paymentMethod).toBe('Split');
    expect(stored().payments).toHaveLength(2);
  });

  it('refuses a split that does not add up to the repriced total', async () => {
    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        ...CART,
        paymentMethod: 'Cash',
        payments: [{ method: 'cash', amount: 5 }],
      });

    expect(response.status).toBe(400);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('validates the split against the server total, not the claimed one', async () => {
    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      // Claims the sale is $5 and pays $5. It is actually $20.
      .send({ ...CART, subtotal: 5, total: 5, paymentMethod: 'Cash', payments: [{ method: 'cash', amount: 5 }] });

    expect(response.status).toBe(400);
  });
});

describe('cash and change', () => {
  it('records what was tendered and what came back', async () => {
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .send({ ...CART, paymentMethod: 'Cash', cashTendered: 50 });

    expect(stored().amountTendered).toBe(50);
    expect(stored().changeGiven).toBe(30);
  });

  it('refuses a tender that does not cover the sale', async () => {
    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .send({ ...CART, paymentMethod: 'Cash', cashTendered: 5 });

    expect(response.status).toBe(400);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('gives change against the cash portion of a split, not the whole total', async () => {
    // $20 sale: $8 on a card, $12 cash, $20 handed over. Change is $8, not $0 —
    // and certainly not change against the card's share.
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        ...CART,
        paymentMethod: 'Cash',
        cashTendered: 20,
        payments: [
          { method: 'card', amount: 8 },
          { method: 'cash', amount: 12 },
        ],
      });

    expect(stored().changeGiven).toBe(8);
  });

  it('leaves the cash fields unset on a card sale', async () => {
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .send({ ...CART, paymentMethod: 'Card' });

    expect(stored().amountTendered).toBeUndefined();
    expect(stored().changeGiven).toBeUndefined();
  });
});

describe('discount usage', () => {
  beforeEach(() => {
    getDiscountTypeById.mockResolvedValue({
      id: 'd1',
      name: 'Senior',
      discountType: 'percentage',
      discountValue: 10,
      isActive: true,
      showInPos: true,
    });
  });

  it('logs the amount the server computed, not the one it was sent', async () => {
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        ...CART,
        paymentMethod: 'Cash',
        discountTotal: 999,
        appliedDiscounts: [{ source: 'quick_discount', id: 'd1' }],
      });

    // 10% of $20.
    expect(logDiscountUsage.mock.calls[0][0].discountAmount).toBe(2);
  });

  it('burns a promo redemption without the client asking', async () => {
    getPromoCodeById.mockResolvedValue({
      id: 'p1',
      name: 'FIVER',
      discountType: 'fixed',
      discountValue: 5,
      isActive: true,
    });

    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        ...CART,
        paymentMethod: 'Cash',
        appliedDiscounts: [{ source: 'promo_code', id: 'p1' }],
      });

    expect(incrementPromoCodeUsage).toHaveBeenCalledWith('p1');
  });

  it('completes the sale even when usage logging fails', async () => {
    // The sale is already committed by then; losing a reporting row must not
    // tell the caller a completed order did not happen.
    logDiscountUsage.mockRejectedValue(new Error('usage table is gone'));

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        ...CART,
        paymentMethod: 'Cash',
        appliedDiscounts: [{ source: 'quick_discount', id: 'd1' }],
      });

    expect(response.status).toBe(201);
  });
});

describe('card linkage', () => {
  it('attaches the terminal transaction to the order', async () => {
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .send({ ...CART, paymentMethod: 'Card', cardTransactionId: 'ch_1', cardAuthCode: 'A42' });

    expect(updateTerminalTransactionByChargeId).toHaveBeenCalledWith('ch_1', {
      orderId: 'o1',
      status: 'approved',
      authCode: 'A42',
    });
  });
});

describe('reading orders', () => {
  it('lists orders', async () => {
    const response = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it('returns one order with its payments', async () => {
    const response = await request(app)
      .get('/api/orders/o1')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe('o1');
  });

  it('404s on an order that does not exist', async () => {
    getOrderById.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/orders/nope')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(404);
  });

  it('finds the orders belonging to a customer email', async () => {
    const response = await request(app)
      .get(`/api/orders/customer/${encodeURIComponent('buyer@example.com')}`)
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(getOrdersByCustomerEmail).toHaveBeenCalledWith('buyer@example.com');
  });

  it('needs orders.read, not merely a session', async () => {
    getUserByEmail.mockResolvedValue({
      id: 'u1',
      email: 'admin@example.com',
      status: 'active',
      roleIds: ['r1'],
      roles: [{ id: 'r1', name: 'Standard', systemRole: 'standard', permissions: { orders: { read: false } } }],
    });

    expect((await request(app).get('/api/orders').set('Authorization', `Bearer ${token()}`)).status).toBe(403);
  });
});
