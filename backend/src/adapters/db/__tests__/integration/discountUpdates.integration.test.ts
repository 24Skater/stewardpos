import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Editing discounts and promo codes, and reading their usage back, against a
 * real Postgres.
 *
 * Both update methods build their SET clause field by field, so every field the
 * admin screen can send is its own branch — and a field with no branch is one
 * the PUT accepts, answers 200 for, and silently does not save.
 */
let h: Harness;
const mark = tag();

const discountIds: string[] = [];
const promoIds: string[] = [];
const customerIds: string[] = [];

beforeAll(async () => {
  h = await connect();
}, 30_000);

afterAll(async () => {
  if (promoIds.length > 0) {
    await h.query('DELETE FROM discount_usage WHERE promo_code_id = ANY($1)', [promoIds]);
    await h.query('DELETE FROM promo_codes WHERE id = ANY($1)', [promoIds]);
  }
  if (discountIds.length > 0) {
    await h.query('DELETE FROM discount_usage WHERE discount_type_id = ANY($1)', [discountIds]);
    await h.query('DELETE FROM discount_types WHERE id = ANY($1)', [discountIds]);
  }
  if (customerIds.length > 0) await h.query('DELETE FROM customers WHERE id = ANY($1)', [customerIds]);
  await h.close();
});

async function makeDiscount() {
  const created = await h.adapter.createDiscountType({
    name: `${mark} Base`,
    discountType: 'percentage',
    discountValue: 10,
    showInPos: true,
    isActive: true,
  });
  discountIds.push(String(created.id));
  return created;
}

async function makePromo(overrides: Record<string, unknown> = {}) {
  const created = await h.adapter.createPromoCode({
    code: `${mark}-${promoIds.length}`,
    name: `${mark} Promo`,
    discountType: 'fixed',
    discountValue: 5,
    startsAt: Date.now() - 60_000,
    isActive: true,
    ...overrides,
  });
  promoIds.push(String(created.id));
  return created;
}

async function makeCustomer() {
  const c = await h.adapter.createCustomer({
    name: `${mark} Buyer ${customerIds.length}`,
    email: `${mark}-${customerIds.length}@example.com`,
  });
  customerIds.push(String(c.id));
  return String(c.id);
}

describe('updateDiscountType', () => {
  it('saves every editable field', async () => {
    const d = await makeDiscount();

    const updated = await h.adapter.updateDiscountType(String(d.id), {
      name: `${mark} Edited`,
      description: 'desc',
      code: `${mark}-CODE`,
      discountType: 'fixed',
      discountValue: 7.5,
      minPurchase: 20,
      maxDiscount: 15,
      appliesTo: 'categories',
      applicableIds: ['cat-1'],
      requiresApproval: true,
      approvalThreshold: 50,
      requiresEmployeeId: true,
      displayOrder: 3,
      color: 'red',
      icon: 'tag',
      showInPos: false,
      isActive: false,
    });

    expect(updated).toMatchObject({
      name: `${mark} Edited`,
      description: 'desc',
      code: `${mark}-CODE`,
      discountType: 'fixed',
      discountValue: 7.5,
      minPurchase: 20,
      maxDiscount: 15,
      appliesTo: 'categories',
      applicableIds: ['cat-1'],
      requiresApproval: true,
      approvalThreshold: 50,
      requiresEmployeeId: true,
      displayOrder: 3,
      color: 'red',
      icon: 'tag',
      showInPos: false,
      isActive: false,
    });
  });

  it('treats an empty update as a read, not as an error', async () => {
    const d = await makeDiscount();

    expect(await h.adapter.updateDiscountType(String(d.id), {})).toMatchObject({ id: d.id, discountValue: 10 });
  });

  it('returns null for a discount type that does not exist', async () => {
    expect(
      await h.adapter.updateDiscountType('00000000-0000-0000-0000-00000000dead', { name: 'x' })
    ).toBeNull();
  });

  it('deletes one, and reports a second delete as nothing deleted', async () => {
    const d = await makeDiscount();

    expect(await h.adapter.deleteDiscountType(String(d.id))).toBe(true);
    expect(await h.adapter.deleteDiscountType(String(d.id))).toBe(false);
  });
});

describe('updatePromoCode', () => {
  it('saves every field it has a branch for, upper-casing the code', async () => {
    const p = await makePromo();
    const startsAt = Date.UTC(2026, 0, 1);
    const expiresAt = Date.UTC(2027, 0, 1);

    const updated = await h.adapter.updatePromoCode(String(p.id), {
      code: `${mark}-edited`,
      name: `${mark} Edited`,
      description: 'desc',
      discountType: 'percentage',
      discountValue: 20,
      minPurchase: 30,
      maxDiscount: 10,
      maxUses: 100,
      maxUsesPerCustomer: 2,
      startsAt,
      expiresAt,
      isActive: false,
      stackable: true,
    });

    expect(updated).toMatchObject({
      code: `${mark}-edited`.toUpperCase(),
      name: `${mark} Edited`,
      description: 'desc',
      discountType: 'percentage',
      discountValue: 20,
      minPurchase: 30,
      maxDiscount: 10,
      maxUses: 100,
      maxUsesPerCustomer: 2,
      startsAt,
      expiresAt,
      isActive: false,
      stackable: true,
    });
  });

  it('clears an expiry when sent null, making the code open-ended', async () => {
    const p = await makePromo({ expiresAt: Date.now() + 86_400_000 });

    expect((await h.adapter.updatePromoCode(String(p.id), { expiresAt: null }))!.expiresAt).toBeNull();
  });

  it('treats an empty update as a read', async () => {
    const p = await makePromo();

    expect(await h.adapter.updatePromoCode(String(p.id), {})).toMatchObject({ id: p.id });
  });

  it('returns null for a promo code that does not exist', async () => {
    expect(await h.adapter.updatePromoCode('00000000-0000-0000-0000-00000000dead', { name: 'x' })).toBeNull();
  });

  it('saves a first-order-only restriction and a minimum item count', async () => {
    const p = await makePromo();

    const updated = await h.adapter.updatePromoCode(String(p.id), { firstOrderOnly: true, minItems: 3 });

    expect(updated).toMatchObject({ firstOrderOnly: true, minItems: 3 });
  });
});

describe('discount usage reads', () => {
  it('counts a customer’s redemptions of one promo, and only theirs', async () => {
    const p = await makePromo();
    const alice = await makeCustomer();
    const bob = await makeCustomer();
    const log = (customerId: string) =>
      h.adapter.logDiscountUsage({
        discountSource: 'promo_code',
        promoCodeId: p.id,
        discountAmount: 5,
        customerId,
      });
    await log(alice);
    await log(alice);
    await log(bob);

    expect(await h.adapter.getPromoCodeUsageByCustomer(String(p.id), alice)).toBe(2);
    expect(await h.adapter.getPromoCodeUsageByCustomer(String(p.id), bob)).toBe(1);
  });

  it('filters usage by customer and by date window', async () => {
    const d = await makeDiscount();
    const carol = await makeCustomer();
    await h.adapter.logDiscountUsage({
      discountSource: 'quick_discount',
      discountTypeId: d.id,
      discountAmount: 3,
      customerId: carol,
    });
    await h.adapter.logDiscountUsage({ discountSource: 'quick_discount', discountTypeId: d.id, discountAmount: 4 });

    const forCarol = await h.adapter.getDiscountUsage({ customerId: carol });
    const inWindow = await h.adapter.getDiscountUsage({
      customerId: carol,
      startDate: Date.now() - 3_600_000,
      endDate: Date.now() + 3_600_000,
    });
    const beforeWindow = await h.adapter.getDiscountUsage({ customerId: carol, endDate: Date.now() - 3_600_000 });

    expect(forCarol).toHaveLength(1);
    expect(Number(forCarol[0].discountAmount)).toBe(3);
    expect(inWindow).toHaveLength(1);
    expect(beforeWindow).toHaveLength(0);
  });

  it('filters usage by order', async () => {
    const order = await h.adapter.createOrder({
      items: [],
      subtotal: 10,
      discountTotal: 2,
      taxTotal: 0,
      total: 8,
      paymentMethod: 'Cash',
      payments: [{ method: 'cash', amount: 8 }],
    });
    const d = await makeDiscount();
    try {
      await h.adapter.logDiscountUsage({
        orderId: order.id,
        discountSource: 'quick_discount',
        discountTypeId: d.id,
        discountAmount: 2,
      });

      const rows = await h.adapter.getDiscountUsage({ orderId: String(order.id) });

      expect(rows).toHaveLength(1);
      expect(String(rows[0].orderId)).toBe(String(order.id));
    } finally {
      await h.query('DELETE FROM discount_usage WHERE order_id = $1', [order.id]);
      await h.query('DELETE FROM payments WHERE order_id = $1', [order.id]);
      await h.query('DELETE FROM orders WHERE id = $1', [order.id]);
    }
  });
});
