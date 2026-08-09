import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Reading returns: the filtered list, the single record, and the stats.
 *
 * `getAllReturns` joins four tables to attach the original order's total and
 * the names of the customer and the person who took the return. Those are LEFT
 * joins deliberately — a walk-in return has no customer and a seeded one may
 * have no staff record — and an inner join would silently drop exactly the
 * returns a manager is most likely to be looking for.
 */
let h: Harness;
const mark = tag();

let staff: string;
let productId: string;
let variantId: string;
let customerId: string;
let orderId: string;
let orderItemId: string;
const returnIds: string[] = [];

async function makeReturn(overrides: Record<string, unknown> = {}) {
  const created = await h.adapter.createReturn({
    originalOrderId: orderId,
    returnNumber: `${mark}-${returnIds.length}`,
    returnType: 'return',
    status: 'pending',
    subtotal: 5,
    taxTotal: 0,
    total: 5,
    refundMethod: 'cash',
    restockItems: true,
    restockingFee: 0,
    createdBy: staff,
    items: [
      {
        originalOrderItemId: orderItemId,
        productId,
        variantId,
        nameSnapshot: `${mark} thing`,
        originalQuantity: 5,
        returnQuantity: 1,
        unitPrice: 5,
        lineTotal: 5,
        condition: 'good',
      },
    ],
    ...overrides,
  });
  returnIds.push(String(created.id));
  return created;
}

/** Only rows this file made, so unrelated data cannot skew a count. */
const mine = (rows: Array<Record<string, unknown>>) =>
  rows.filter((row) => returnIds.includes(String(row.id)));

beforeAll(async () => {
  h = await connect();

  const user = await h.adapter.createUser({
    email: `${mark}-staff@example.com`,
    passwordHash: 'not-a-real-hash',
    name: `${mark} staff`,
    status: 'active',
    roleIds: [],
  });
  staff = String(user.id);

  // `order_items` requires both `product_id` and `variant_id`, so a line needs
  // a real product *and* a real variant — not just a name and a price.
  const product = await h.adapter.createProduct({
    name: `${mark} thing`,
    description: mark,
    category: `${mark}Cat`,
    basePrice: 5,
    variants: [],
  });
  productId = String(product!.id);
  const variant = await h.adapter.createVariant(productId, { sku: `${mark}-V`, stock: 100 });
  variantId = String(variant!.id);

  const customer = await h.adapter.createCustomer({
    name: `${mark} Buyer`,
    email: `${mark}-buyer@example.com`,
  });
  customerId = String(customer.id);

  const order = await h.adapter.createOrder({
    items: [
      {
        productId,
        variantId,
        nameSnapshot: `${mark} thing`,
        quantity: 5,
        unitPrice: 5,
        lineDiscount: 0,
        lineTotal: 25,
      },
    ],
    subtotal: 25,
    discountTotal: 0,
    taxTotal: 0,
    total: 25,
    paymentMethod: 'Cash',
    payments: [{ method: 'cash', amount: 25 }],
  });
  orderId = String(order.id);
  const { rows } = await h.query('SELECT id FROM order_items WHERE order_id = $1', [orderId]);
  orderItemId = String(rows[0].id);
}, 30_000);

afterAll(async () => {
  if (returnIds.length > 0) {
    await h.query('DELETE FROM return_items WHERE return_id = ANY($1)', [returnIds]);
    await h.query('DELETE FROM returns WHERE id = ANY($1)', [returnIds]);
  }
  await h.query('DELETE FROM payments WHERE order_id = $1', [orderId]);
  await h.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
  await h.query('DELETE FROM orders WHERE id = $1', [orderId]);
  await h.query('DELETE FROM customers WHERE id = $1', [customerId]);
  await h.query('DELETE FROM products WHERE id = $1', [productId]);
  await h.query('DELETE FROM users WHERE id = $1', [staff]);
  await h.close();
});

describe('getAllReturns', () => {
  it('lists them', async () => {
    await makeReturn();

    expect(mine(await h.adapter.getAllReturns()).length).toBeGreaterThan(0);
  });

  it('attaches the original order’s total', async () => {
    await makeReturn();

    const found = mine(await h.adapter.getAllReturns())[0];
    expect(Number(found.originalOrderTotal ?? found.original_order_total)).toBe(25);
  });

  it('attaches the name of whoever took the return', async () => {
    await makeReturn();

    const found = mine(await h.adapter.getAllReturns())[0];
    expect(found.createdByName ?? found.created_by_name).toBe(`${mark} staff`);
  });

  it('includes a return with no customer at all', async () => {
    // The joins are LEFT for this reason: a walk-in return has no customer, and
    // an inner join would drop exactly the returns a manager looks for.
    const created = await makeReturn({ customerId: null });

    const found = await h.adapter.getAllReturns();
    expect(found.map((r) => String(r.id))).toContain(String(created.id));
  });

  it('filters by status', async () => {
    await makeReturn({ status: 'approved', returnNumber: `${mark}-approved` });

    const approved = mine(await h.adapter.getAllReturns({ status: 'approved' }));
    expect(approved.every((r) => r.status === 'approved')).toBe(true);
    expect(approved.length).toBeGreaterThan(0);
  });

  it('excludes other statuses when filtering', async () => {
    const pendingOnly = mine(await h.adapter.getAllReturns({ status: 'pending' }));

    expect(pendingOnly.every((r) => r.status === 'pending')).toBe(true);
  });

  it('filters by customer', async () => {
    const created = await makeReturn({ customerId, returnNumber: `${mark}-cust` });

    const forCustomer = await h.adapter.getAllReturns({ customerId });
    expect(forCustomer.map((r) => String(r.id))).toContain(String(created.id));
  });

  it('filters by date range', async () => {
    await makeReturn();

    const recent = mine(
      await h.adapter.getAllReturns({ startDate: Date.now() - 60_000, endDate: Date.now() + 60_000 })
    );
    expect(recent.length).toBeGreaterThan(0);
  });

  it('returns nothing outside the date range', async () => {
    await makeReturn();

    expect(mine(await h.adapter.getAllReturns({ endDate: Date.now() - 86_400_000 }))).toHaveLength(0);
  });
});

describe('getReturnById', () => {
  it('reads one back with its items', async () => {
    const created = await makeReturn();

    const found = await h.adapter.getReturnById(String(created.id));
    expect(found.items).toHaveLength(1);
    expect(found.total).toBe(5);
  });

  it('returns null for one that does not exist', async () => {
    expect(await h.adapter.getReturnById('00000000-0000-0000-0000-0000000000ff')).toBeNull();
  });
});

describe('getReturnsByCustomer', () => {
  it('finds the returns belonging to a customer', async () => {
    const created = await makeReturn({ customerId, returnNumber: `${mark}-bycust` });

    const found = await h.adapter.getReturnsByCustomer(customerId);
    expect(found.map((r) => String(r.id))).toContain(String(created.id));
  });

  it('returns nothing for a customer with none', async () => {
    expect(
      await h.adapter.getReturnsByCustomer('00000000-0000-0000-0000-0000000000ff')
    ).toEqual([]);
  });
});

describe('getReturnStats', () => {
  it('counts and totals what has been returned', async () => {
    await makeReturn();

    const stats = await h.adapter.getReturnStats();

    expect(Number(stats.totalReturns)).toBeGreaterThan(0);
  });

  it('narrows to a date range', async () => {
    const stats = await h.adapter.getReturnStats({ endDate: Date.now() - 86_400_000 });

    expect(Number(stats.totalReturns)).toBe(0);
  });
});
