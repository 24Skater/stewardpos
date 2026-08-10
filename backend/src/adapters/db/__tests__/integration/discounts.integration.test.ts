import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Discount and promo-code SQL against a real Postgres.
 *
 * These are money: a discount type is what the server reprices against, so a
 * row that reads back with the wrong `discountValue` or a stale `isActive`
 * changes what a customer pays. Redemption counting is the other half — the
 * increment is what stops a single-use code being spent repeatedly, and it runs
 * server-side precisely so a client cannot decline to report it.
 */
let h: Harness;
const mark = tag();

const discountIds: string[] = [];
const promoIds: string[] = [];

async function makeDiscount(overrides: Record<string, unknown> = {}) {
  const created = await h.adapter.createDiscountType({
    name: `${mark} Senior`,
    discountType: 'percentage',
    discountValue: 10,
    showInPos: true,
    isActive: true,
    ...overrides,
  });
  discountIds.push(String(created.id));
  return created;
}

async function makePromo(overrides: Record<string, unknown> = {}) {
  const created = await h.adapter.createPromoCode({
    code: `${mark}-${promoIds.length}`,
    name: `${mark} Fiver`,
    discountType: 'fixed',
    discountValue: 5,
    startsAt: Date.now() - 60_000,
    isActive: true,
    ...overrides,
  });
  promoIds.push(String(created.id));
  return created;
}

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
  await h.close();
});

describe('discount types', () => {
  it('round-trips the value the server will reprice against', async () => {
    const created = await makeDiscount({ discountValue: 12.5 });

    const found = await h.adapter.getDiscountTypeById(String(created.id));
    expect(found).toMatchObject({ discountType: 'percentage', discountValue: 12.5 });
  });

  it('carries isActive, which is what makes a withdrawn discount stop applying', async () => {
    const created = await makeDiscount({ isActive: false });

    expect(await h.adapter.getDiscountTypeById(String(created.id))).toMatchObject({
      isActive: false,
    });
  });

  it('carries requiresEmployeeId, which gates the employee discount', async () => {
    const created = await makeDiscount({ requiresEmployeeId: true });

    expect(await h.adapter.getDiscountTypeById(String(created.id))).toMatchObject({
      requiresEmployeeId: true,
    });
  });

  it('defaults showInPos on rather than off', async () => {
    // `showInPos !== false` in the insert: omitting it must mean visible, or a
    // discount created through the API would vanish from the register.
    const created = await makeDiscount({ showInPos: undefined });

    expect(await h.adapter.getDiscountTypeById(String(created.id))).toMatchObject({
      showInPos: true,
    });
  });

  it('returns null for one that does not exist', async () => {
    expect(await h.adapter.getDiscountTypeById('00000000-0000-0000-0000-0000000000ff')).toBeNull();
  });

  it('lists what it created', async () => {
    const created = await makeDiscount();

    const all = await h.adapter.getAllDiscountTypes();
    expect(all.find((d) => String(d.id) === String(created.id))).toBeTruthy();
  });
});

describe('promo codes', () => {
  it('stores the code upper-cased, so entry is case-insensitive', async () => {
    const created = await makePromo({ code: `${mark}-lower` });

    expect(String(created.code)).toBe(`${mark}-lower`.toUpperCase());
  });

  it('round-trips its discount', async () => {
    const created = await makePromo({ discountType: 'fixed', discountValue: 7.5 });

    expect(await h.adapter.getPromoCodeById(String(created.id))).toMatchObject({
      discountType: 'fixed',
      discountValue: 7.5,
    });
  });

  it('starts with no uses recorded', async () => {
    const created = await makePromo();

    expect(Number((await h.adapter.getPromoCodeById(String(created.id))).currentUses)).toBe(0);
  });

  it('burns a redemption', async () => {
    // Server-side and unconditional: the client is not asked whether it used
    // the code, because a client that declines to say would redeem forever.
    const created = await makePromo();

    await h.adapter.incrementPromoCodeUsage(String(created.id));

    expect(Number((await h.adapter.getPromoCodeById(String(created.id))).currentUses)).toBe(1);
  });

  it('counts every redemption, including concurrent ones', async () => {
    // `current_uses = current_uses + 1` in SQL rather than a read-then-write:
    // two simultaneous sales must both count, or a max-uses limit leaks.
    const created = await makePromo();

    await Promise.all(
      Array.from({ length: 5 }, () => h.adapter.incrementPromoCodeUsage(String(created.id)))
    );

    expect(Number((await h.adapter.getPromoCodeById(String(created.id))).currentUses)).toBe(5);
  });

  it('carries maxUses, which is what a limit is checked against', async () => {
    const created = await makePromo({ maxUses: 1 });

    expect(Number((await h.adapter.getPromoCodeById(String(created.id))).maxUses)).toBe(1);
  });

  it('carries an expiry', async () => {
    const expires = Date.now() + 86_400_000;
    const created = await makePromo({ expiresAt: expires });

    const found = await h.adapter.getPromoCodeById(String(created.id));
    expect(Number(found.expiresAt)).toBeGreaterThan(Date.now());
  });
});

describe('discount usage', () => {
  it('records what was actually given', async () => {
    // The route logs the amount the *server* computed, not the one it was sent.
    // This is the row that reporting reads, so a wrong number here understates
    // or overstates revenue.
    const discount = await makeDiscount();

    await h.adapter.logDiscountUsage({
      discountSource: 'quick_discount',
      discountTypeId: discount.id,
      discountName: String(discount.name),
      discountType: 'percentage',
      discountValue: 10,
      discountAmount: 2.5,
    });

    const { rows } = await h.query('SELECT * FROM discount_usage WHERE discount_type_id = $1', [
      discount.id,
    ]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].discount_amount)).toBe(2.5);
  });
});
