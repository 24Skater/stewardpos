import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Promo code validation.
 *
 * Every guard here is a way a code should stop working — expired, used up,
 * already used by this customer, below the minimum. Each is money: a guard that
 * silently passes gives away a discount the shop did not offer, and one that
 * wrongly fails refuses a customer a discount they were promised.
 *
 * The route answers `success: false, valid: false` with a message rather than
 * erroring, because "this code is expired" is an answer, not a fault.
 */
const getUserByEmail = vi.fn();
const getPromoCodeByCode = vi.fn();
const getPromoCodeUsageByCustomer = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({ getUserByEmail, getPromoCodeByCode, getPromoCodeUsageByCustomer }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const HOUR = 3_600_000;

/** A code that passes every guard unless a test changes one. */
function promo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    code: 'FIVER',
    name: 'Five off',
    discountType: 'fixed',
    discountValue: 5,
    isActive: true,
    startsAt: Date.now() - HOUR,
    expiresAt: null,
    maxUses: null,
    currentUses: 0,
    maxUsesPerCustomer: null,
    firstOrderOnly: false,
    minPurchase: 0,
    minItems: 0,
    maxDiscount: null,
    specificCustomers: [],
    ...overrides,
  };
}

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

const validate = (body: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/discounts/promos/validate')
    .set(auth())
    .send({ code: 'FIVER', cartTotal: 50, itemCount: 2, ...body });

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  });
  getPromoCodeByCode.mockResolvedValue(promo());
  getPromoCodeUsageByCustomer.mockResolvedValue(0);
});

describe('accepting a code', () => {
  it('validates a good one and prices the discount', async () => {
    const response = await validate();

    expect(response.status).toBe(200);
    expect(response.body.data.valid).toBe(true);
    expect(response.body.data.promo.discountAmount).toBe(5);
  });

  it('looks the code up upper-cased, so entry is case-insensitive', async () => {
    await validate({ code: 'fiver' });

    expect(getPromoCodeByCode).toHaveBeenCalledWith('FIVER');
  });

  it('prices a percentage against the cart', async () => {
    getPromoCodeByCode.mockResolvedValue(promo({ discountType: 'percentage', discountValue: 10 }));

    expect((await validate({ cartTotal: 80 })).body.data.promo.discountAmount).toBe(8);
  });

  it('caps a percentage at maxDiscount', async () => {
    // Without the cap, "20% off" on a large basket gives away far more than
    // the promotion intended.
    getPromoCodeByCode.mockResolvedValue(
      promo({ discountType: 'percentage', discountValue: 50, maxDiscount: 10 })
    );

    expect((await validate({ cartTotal: 200 })).body.data.promo.discountAmount).toBe(10);
  });

  it('never discounts more than the cart is worth', async () => {
    // A $5 code on a $2 basket takes $2, not $5 — otherwise the sale total goes
    // negative and the shop owes the customer money.
    getPromoCodeByCode.mockResolvedValue(promo({ discountType: 'fixed', discountValue: 5 }));

    expect((await validate({ cartTotal: 2 })).body.data.promo.discountAmount).toBe(2);
  });
});

describe('refusing a code', () => {
  it('refuses one that does not exist', async () => {
    getPromoCodeByCode.mockResolvedValue(null);

    const response = await validate();

    expect(response.body.valid).toBe(false);
    expect(response.body.message).toMatch(/invalid/i);
  });

  it('refuses a withdrawn one', async () => {
    getPromoCodeByCode.mockResolvedValue(promo({ isActive: false }));

    expect((await validate()).body.message).toMatch(/no longer active/i);
  });

  it('refuses one that has not started', async () => {
    getPromoCodeByCode.mockResolvedValue(promo({ startsAt: Date.now() + HOUR }));

    expect((await validate()).body.message).toMatch(/not yet valid/i);
  });

  it('refuses an expired one', async () => {
    getPromoCodeByCode.mockResolvedValue(promo({ expiresAt: Date.now() - HOUR }));

    expect((await validate()).body.message).toMatch(/expired/i);
  });

  it('refuses one that has reached its usage limit', async () => {
    getPromoCodeByCode.mockResolvedValue(promo({ maxUses: 10, currentUses: 10 }));

    expect((await validate()).body.message).toMatch(/usage limit/i);
  });

  it('refuses one this customer has already used', async () => {
    getPromoCodeByCode.mockResolvedValue(promo({ maxUsesPerCustomer: 1 }));
    getPromoCodeUsageByCustomer.mockResolvedValue(1);

    expect((await validate({ customerId: 'c1' })).body.message).toMatch(/already used/i);
  });

  it('refuses a first-order code on a repeat order', async () => {
    getPromoCodeByCode.mockResolvedValue(promo({ firstOrderOnly: true }));

    expect((await validate({ isFirstOrder: false })).body.message).toMatch(/first orders/i);
  });

  it('refuses when the basket is below the minimum spend', async () => {
    getPromoCodeByCode.mockResolvedValue(promo({ minPurchase: 100 }));

    expect((await validate({ cartTotal: 50 })).body.message).toMatch(/minimum purchase/i);
  });

  it('refuses when the basket is below the minimum item count', async () => {
    getPromoCodeByCode.mockResolvedValue(promo({ minItems: 5 }));

    expect((await validate({ itemCount: 2 })).body.message).toMatch(/minimum of 5 items/i);
  });

  it('refuses a customer-specific code for someone else', async () => {
    getPromoCodeByCode.mockResolvedValue(promo({ specificCustomers: ['someone-else'] }));

    expect((await validate({ customerId: 'c1' })).body.message).toMatch(/not available/i);
  });

  it('allows a customer-specific code for the named customer', async () => {
    getPromoCodeByCode.mockResolvedValue(promo({ specificCustomers: ['c1'] }));

    expect((await validate({ customerId: 'c1' })).body.data.valid).toBe(true);
  });
});

describe('the request itself', () => {
  it('rejects a missing code', async () => {
    const response = await request(app)
      .post('/api/discounts/promos/validate')
      .set(auth())
      .send({ cartTotal: 10, itemCount: 1 });

    expect(response.status).toBe(400);
  });

  it('rejects a negative cart total', async () => {
    expect((await validate({ cartTotal: -5 })).status).toBe(400);
  });

  it('needs orders.write — validating is part of ringing up a sale', async () => {
    getUserByEmail.mockResolvedValue({
      id: 'u1',
      email: 'admin@example.com',
      status: 'active',
      roleIds: ['r1'],
      roles: [{ id: 'r1', name: 'Viewer', systemRole: 'standard', permissions: { orders: { write: false } } }],
    });

    expect((await validate()).status).toBe(403);
  });
});
