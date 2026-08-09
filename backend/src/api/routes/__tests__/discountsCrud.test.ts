import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Discount and promo code management.
 *
 * `promoValidation.test.ts` covers redeeming; this covers creating, editing,
 * and withdrawing — the side a shop touches, and where a bad value becomes a
 * standing offer rather than a one-off mistake. A 200% discount saved by a
 * typo pays customers to shop.
 *
 * Deleting either kind is admin-only, deliberately: a discount that has been
 * used is referenced by reporting rows, so removing it is not the same decision
 * as switching it off.
 */
const getUserByEmail = vi.fn();
const getAllDiscountTypes = vi.fn();
const getDiscountTypesForPOS = vi.fn();
const getDiscountTypeById = vi.fn();
const createDiscountType = vi.fn();
const updateDiscountType = vi.fn();
const deleteDiscountType = vi.fn();
const getAllPromoCodes = vi.fn();
const getPromoCodeById = vi.fn();
const createPromoCode = vi.fn();
const updatePromoCode = vi.fn();
const deletePromoCode = vi.fn();
const getAllEmployeeDiscounts = vi.fn();
const upsertEmployeeDiscount = vi.fn();
const getDiscountStats = vi.fn();
const getDiscountUsage = vi.fn();
const logDiscountUsage = vi.fn();
const getEmployeeDiscountByUser = vi.fn();
const deleteEmployeeDiscount = vi.fn();
const incrementPromoCodeUsage = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getAllDiscountTypes,
      getDiscountTypesForPOS,
      getDiscountTypeById,
      createDiscountType,
      updateDiscountType,
      deleteDiscountType,
      getAllPromoCodes,
      getPromoCodeById,
      createPromoCode,
      updatePromoCode,
      deletePromoCode,
      getAllEmployeeDiscounts,
      upsertEmployeeDiscount,
      getDiscountStats,
      getDiscountUsage,
      logDiscountUsage,
      getEmployeeDiscountByUser,
      deleteEmployeeDiscount,
      incrementPromoCodeUsage,
      createAuditLog,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const DISCOUNT = { id: 'd1', name: 'Senior', discountType: 'percentage', discountValue: 10 };
const PROMO = { id: 'p1', code: 'FIVER', discountType: 'fixed', discountValue: 5 };

const PROMO_BODY = {
  code: 'FIVER',
  name: 'Five off',
  discountType: 'fixed',
  discountValue: 5,
  startsAt: new Date().toISOString(),
};

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function actor(permissions: Record<string, unknown>, systemRole = 'admin') {
  return {
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Manager', systemRole, permissions }],
  };
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(actor({ discounts: { read: true, write: true, delete: true } }));
  getAllDiscountTypes.mockResolvedValue([DISCOUNT]);
  getDiscountTypesForPOS.mockResolvedValue([DISCOUNT]);
  getDiscountTypeById.mockResolvedValue(DISCOUNT);
  createDiscountType.mockResolvedValue(DISCOUNT);
  updateDiscountType.mockResolvedValue(DISCOUNT);
  deleteDiscountType.mockResolvedValue(true);
  getAllPromoCodes.mockResolvedValue([PROMO]);
  getPromoCodeById.mockResolvedValue(PROMO);
  createPromoCode.mockResolvedValue(PROMO);
  updatePromoCode.mockResolvedValue(PROMO);
  deletePromoCode.mockResolvedValue(true);
  getAllEmployeeDiscounts.mockResolvedValue([]);
  upsertEmployeeDiscount.mockResolvedValue({ userId: 'u2', discountPercentage: 15 });
  getDiscountStats.mockResolvedValue({ totalDiscounts: 3, totalDiscountAmount: 12.5 });
  getDiscountUsage.mockResolvedValue([{ id: 'u1', discountAmount: 2.5 }]);
  logDiscountUsage.mockResolvedValue({ id: 'u1' });
  getEmployeeDiscountByUser.mockResolvedValue({ userId: 'u2', discountPercentage: 15 });
  deleteEmployeeDiscount.mockResolvedValue(true);
  incrementPromoCodeUsage.mockResolvedValue(undefined);
  createAuditLog.mockResolvedValue({});
});

describe('discount types', () => {
  it('lists them', async () => {
    expect((await request(app).get('/api/discounts/types').set(auth())).body.data).toHaveLength(1);
  });

  it('serves the register a filtered list', async () => {
    // The register shows only what a cashier may apply; the admin list is the
    // full set, including withdrawn ones.
    await request(app).get('/api/discounts/types/pos').set(auth());

    expect(getDiscountTypesForPOS).toHaveBeenCalled();
    expect(getAllDiscountTypes).not.toHaveBeenCalled();
  });

  it('is not confused by /pos preceding /:id', async () => {
    await request(app).get('/api/discounts/types/pos').set(auth());

    expect(getDiscountTypeById).not.toHaveBeenCalled();
  });

  it('creates one', async () => {
    const response = await request(app)
      .post('/api/discounts/types')
      .set(auth())
      .send({ name: 'Senior', discountType: 'percentage', discountValue: 10 });

    expect(response.status).toBe(201);
  });

  it('rejects a negative discount', async () => {
    // A negative discount is a surcharge, and nothing downstream treats it as
    // one — it would simply inflate the total with no record of why.
    const response = await request(app)
      .post('/api/discounts/types')
      .set(auth())
      .send({ name: 'Bad', discountType: 'fixed', discountValue: -5 });

    expect(response.status).toBe(400);
    expect(createDiscountType).not.toHaveBeenCalled();
  });

  it('rejects an unknown discount type', async () => {
    const response = await request(app)
      .post('/api/discounts/types')
      .set(auth())
      .send({ name: 'Odd', discountType: 'bogof', discountValue: 1 });

    expect(response.status).toBe(400);
  });

  it('requires a name, since it is what a cashier picks from', async () => {
    const response = await request(app)
      .post('/api/discounts/types')
      .set(auth())
      .send({ discountType: 'percentage', discountValue: 10 });

    expect(response.status).toBe(400);
  });

  it('defaults showInPos on, so a new discount is reachable', async () => {
    await request(app)
      .post('/api/discounts/types')
      .set(auth())
      .send({ name: 'Senior', discountType: 'percentage', discountValue: 10 });

    expect(createDiscountType.mock.calls[0][0].showInPos).toBe(true);
  });

  it('updates one', async () => {
    await request(app)
      .put('/api/discounts/types/d1')
      .set(auth())
      .send({ name: 'Senior', discountType: 'percentage', discountValue: 15 });

    expect(updateDiscountType).toHaveBeenCalledWith('d1', expect.objectContaining({ discountValue: 15 }));
  });

  it('404s when updating one that does not exist', async () => {
    updateDiscountType.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/discounts/types/nope')
      .set(auth())
      .send({ name: 'X', discountType: 'fixed', discountValue: 1 });

    expect(response.status).toBe(404);
  });

  it('needs admin to delete, not merely discounts.delete', async () => {
    // A used discount is referenced by reporting rows, so removing it is a
    // different decision from switching it off.
    getUserByEmail.mockResolvedValue(
      actor({ discounts: { read: true, write: true, delete: true } }, 'standard')
    );

    expect((await request(app).delete('/api/discounts/types/d1').set(auth())).status).toBe(403);
    expect(deleteDiscountType).not.toHaveBeenCalled();
  });

  it('needs discounts.write to create', async () => {
    getUserByEmail.mockResolvedValue(actor({ discounts: { read: true, write: false } }, 'standard'));

    const response = await request(app)
      .post('/api/discounts/types')
      .set(auth())
      .send({ name: 'Senior', discountType: 'percentage', discountValue: 10 });

    expect(response.status).toBe(403);
  });
});

describe('promo codes', () => {
  it('lists them', async () => {
    expect((await request(app).get('/api/discounts/promos').set(auth())).body.data).toHaveLength(1);
  });

  it('creates one', async () => {
    expect((await request(app).post('/api/discounts/promos').set(auth()).send(PROMO_BODY)).status).toBe(
      201
    );
  });

  it('requires a start date', async () => {
    // Without one, "not yet valid" cannot be evaluated and the code is live the
    // instant it is saved.
    const { startsAt: _omitted, ...withoutStart } = PROMO_BODY;

    const response = await request(app).post('/api/discounts/promos').set(auth()).send(withoutStart);

    expect(response.status).toBe(400);
    expect(createPromoCode).not.toHaveBeenCalled();
  });

  it('rejects a start date that is not a real timestamp', async () => {
    const response = await request(app)
      .post('/api/discounts/promos')
      .set(auth())
      .send({ ...PROMO_BODY, startsAt: 'next tuesday' });

    expect(response.status).toBe(400);
  });

  it('rejects an empty code', async () => {
    const response = await request(app)
      .post('/api/discounts/promos')
      .set(auth())
      .send({ ...PROMO_BODY, code: '' });

    expect(response.status).toBe(400);
  });

  it('refuses a maxUses of zero, which would be unusable rather than unlimited', async () => {
    // Unlimited is expressed by omitting it. Zero would create a code that can
    // never be redeemed, which nobody means to do.
    const response = await request(app)
      .post('/api/discounts/promos')
      .set(auth())
      .send({ ...PROMO_BODY, maxUses: 0 });

    expect(response.status).toBe(400);
  });

  it('defaults each customer to a single use', async () => {
    await request(app).post('/api/discounts/promos').set(auth()).send(PROMO_BODY);

    expect(createPromoCode.mock.calls[0][0].maxUsesPerCustomer).toBe(1);
  });

  it('defaults to not stackable', async () => {
    // Stacking multiplies discounts. It has to be chosen, not inherited.
    await request(app).post('/api/discounts/promos').set(auth()).send(PROMO_BODY);

    expect(createPromoCode.mock.calls[0][0].stackable).toBe(false);
  });

  it('needs admin to delete', async () => {
    getUserByEmail.mockResolvedValue(
      actor({ discounts: { read: true, write: true, delete: true } }, 'standard')
    );

    expect((await request(app).delete('/api/discounts/promos/p1').set(auth())).status).toBe(403);
  });
});

describe('employee discounts', () => {
  it('lists them', async () => {
    expect((await request(app).get('/api/discounts/employee').set(auth())).status).toBe(200);
  });

  it('refuses a percentage above 100', async () => {
    // Over 100% the shop pays the employee to take stock.
    const response = await request(app)
      .post('/api/discounts/employee')
      .set(auth())
      .send({ userId: 'u2', discountPercentage: 120 });

    expect(response.status).toBe(400);
    expect(upsertEmployeeDiscount).not.toHaveBeenCalled();
  });

  it('accepts exactly 100, which is a legitimate staff perk', async () => {
    const response = await request(app)
      .post('/api/discounts/employee')
      .set(auth())
      .send({ userId: 'u2', discountPercentage: 100 });

    expect(response.status).toBeLessThan(400);
  });

  it('requires a user to attach it to', async () => {
    const response = await request(app)
      .post('/api/discounts/employee')
      .set(auth())
      .send({ discountPercentage: 10 });

    expect(response.status).toBe(400);
  });
});

describe('GET /api/discounts/stats', () => {
  it('reports what has been given away', async () => {
    const response = await request(app).get('/api/discounts/stats').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ totalDiscountAmount: 12.5 });
  });
});

describe('discount usage records', () => {
  it('lists what has been given away', async () => {
    const response = await request(app).get('/api/discounts/usage').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it('passes a date range through as numbers', async () => {
    await request(app)
      .get('/api/discounts/usage?startDate=1700000000000&endDate=1800000000000')
      .set(auth());

    expect(getDiscountUsage).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: 1700000000000, endDate: 1800000000000 })
    );
  });

  it('records a usage entry', async () => {
    const response = await request(app)
      .post('/api/discounts/usage')
      .set(auth())
      .send({
        discountSource: 'manual',
        discountName: 'Goodwill',
        discountType: 'fixed',
        discountValue: 5,
        discountAmount: 5,
      });

    expect(response.status).toBeLessThan(400);
    expect(logDiscountUsage).toHaveBeenCalled();
  });

  it('needs orders.write to record one, since it accompanies a sale', async () => {
    getUserByEmail.mockResolvedValue(
      actor({ discounts: { read: true }, orders: { write: false } }, 'standard')
    );

    const response = await request(app)
      .post('/api/discounts/usage')
      .set(auth())
      .send({ discountSource: 'manual', discountName: 'x', discountType: 'fixed', discountValue: 1, discountAmount: 1 });

    expect(response.status).toBe(403);
  });

  it('is not read as a promo id', async () => {
    // `/usage` sits alongside `/promos/:id`; the two must not collide.
    await request(app).get('/api/discounts/usage').set(auth());

    expect(getPromoCodeById).not.toHaveBeenCalled();
  });
});

describe('employee discount for one person', () => {
  it('reads theirs', async () => {
    const response = await request(app).get('/api/discounts/employee/u2').set(auth());

    expect(response.status).toBe(200);
    expect(getEmployeeDiscountByUser).toHaveBeenCalledWith('u2');
  });

  it('answers with null when they have none, rather than 404ing', async () => {
    // "This employee has no discount" is an answer, not a missing resource — a
    // 404 would read as "no such employee" and send someone looking for a bug
    // in the user list. Same reasoning as returns-by-order returning an empty
    // list. My first version of this expected 404; the route is right.
    getEmployeeDiscountByUser.mockResolvedValue(null);

    const response = await request(app).get('/api/discounts/employee/u2').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
  });

  it('is admin-only to remove', async () => {
    getUserByEmail.mockResolvedValue(
      actor({ discounts: { read: true, write: true, delete: true } }, 'standard')
    );

    expect((await request(app).delete('/api/discounts/employee/u2').set(auth())).status).toBe(403);
    expect(deleteEmployeeDiscount).not.toHaveBeenCalled();
  });

  it('removes it for an admin', async () => {
    expect((await request(app).delete('/api/discounts/employee/u2').set(auth())).status).toBe(200);
  });
});

describe('POST /api/discounts/promos/:id/use', () => {
  it('burns a redemption', async () => {
    const response = await request(app).post('/api/discounts/promos/p1/use').set(auth());

    expect(response.status).toBe(200);
    expect(incrementPromoCodeUsage).toHaveBeenCalledWith('p1');
  });

  it('needs orders.write, since redeeming happens during a sale', async () => {
    getUserByEmail.mockResolvedValue(
      actor({ discounts: { read: true }, orders: { write: false } }, 'standard')
    );

    expect((await request(app).post('/api/discounts/promos/p1/use').set(auth())).status).toBe(403);
  });
});
