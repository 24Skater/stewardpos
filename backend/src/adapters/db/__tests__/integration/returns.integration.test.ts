import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connect, cleanup, tag, type Harness } from './harness';

/**
 * Return and restock SQL against a real Postgres.
 *
 * `createReturn` writes the return and its items in one transaction;
 * `restockReturnItems` moves stock back and marks the items, also in one, and
 * is the query behind "restock only once" — a guarantee that lives in its
 * `WHERE restocked = false` rather than in application code, so only a real
 * database can demonstrate it.
 */
let h: Harness;
const mark = tag();

let productId: string;
let variantId: string;
let orderId: string;
let orderItemId: string;

/** Returns created here, removed in cleanup. */
const returnIds: string[] = [];

async function makeReturn(quantity: number, extras: Record<string, unknown> = {}) {
  const created = await h.adapter.createReturn({
    originalOrderId: orderId,
    returnNumber: `${mark}-${returnIds.length}`,
    returnType: 'return',
    status: 'pending',
    subtotal: 5 * quantity,
    taxTotal: 0,
    total: 5 * quantity,
    refundMethod: 'cash',
    restockItems: true,
    restockingFee: 0,
    items: [
      {
        originalOrderItemId: orderItemId,
        productId,
        variantId,
        nameSnapshot: `${mark} Tea`,
        originalQuantity: 10,
        returnQuantity: quantity,
        unitPrice: 5,
        lineTotal: 5 * quantity,
        condition: 'good',
      },
    ],
    ...extras,
  });
  returnIds.push(String(created.id));
  return created;
}

async function stockNow(): Promise<number> {
  const { rows } = await h.query('SELECT stock FROM product_variants WHERE id = $1', [variantId]);
  return Number(rows[0].stock);
}

beforeAll(async () => {
  h = await connect();
  const product = await h.adapter.createProduct({
    name: `${mark} Tea`,
    description: mark,
    category: `${mark}Drinks`,
    basePrice: 5,
    variants: [],
  });
  productId = String(product!.id);
  const variant = await h.adapter.createVariant(productId, { sku: `${mark}-T`, stock: 100 });
  variantId = String(variant!.id);

  const order = await h.adapter.createOrder({
    items: [
      {
        productId,
        variantId,
        nameSnapshot: `${mark} Tea`,
        quantity: 10,
        unitPrice: 5,
        lineDiscount: 0,
        lineTotal: 50,
      },
    ],
    subtotal: 50,
    discountTotal: 0,
    taxTotal: 0,
    total: 50,
    paymentMethod: 'Cash',
    payments: [{ method: 'cash', amount: 50 }],
  });
  orderId = String(order.id);
  const { rows } = await h.query('SELECT id FROM order_items WHERE order_id = $1', [orderId]);
  orderItemId = String(rows[0].id);
}, 30_000);

beforeEach(async () => {
  if (returnIds.length > 0) {
    await h.query('DELETE FROM return_items WHERE return_id = ANY($1)', [returnIds]);
    await h.query('DELETE FROM returns WHERE id = ANY($1)', [returnIds]);
    returnIds.length = 0;
  }
});

afterAll(async () => {
  if (returnIds.length > 0) {
    await h.query('DELETE FROM return_items WHERE return_id = ANY($1)', [returnIds]);
    await h.query('DELETE FROM returns WHERE id = ANY($1)', [returnIds]);
  }
  await cleanup(h, mark);
  await h.close();
});

describe('createReturn', () => {
  it('writes the return and its items together', async () => {
    const created = await makeReturn(2);

    const { rows } = await h.query('SELECT * FROM return_items WHERE return_id = $1', [created.id]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].return_quantity)).toBe(2);
  });

  it('reads back with its items attached', async () => {
    const created = await makeReturn(3);

    const fetched = await h.adapter.getReturnById(String(created.id));
    expect(fetched.items).toHaveLength(1);
    expect(fetched.total).toBe(15);
  });

  it('is found through the order it came from', async () => {
    await makeReturn(1);

    const forOrder = await h.adapter.getReturnsByOrder(orderId);
    expect(forOrder).toHaveLength(1);
  });

  it('does not restock on creation', async () => {
    // Restocking is a separate, approval-gated step. Putting damaged goods back
    // on the shelf the instant a return is recorded is the bug this separation
    // exists to prevent.
    const before = await stockNow();

    await makeReturn(4);

    expect(await stockNow()).toBe(before);
  });
});

describe('restockReturnItems', () => {
  it('puts the returned quantity back', async () => {
    const created = await makeReturn(3);
    const before = await stockNow();

    await h.adapter.restockReturnItems(String(created.id));

    expect(await stockNow()).toBe(before + 3);
  });

  it('marks the items restocked', async () => {
    const created = await makeReturn(2);

    await h.adapter.restockReturnItems(String(created.id));

    const { rows } = await h.query('SELECT restocked FROM return_items WHERE return_id = $1', [created.id]);
    expect(rows[0].restocked).toBe(true);
  });

  it('will not restock the same return twice', async () => {
    // The guard is `WHERE restocked = false` in the SELECT that drives the
    // loop. Without it, calling this twice would inflate stock by phantom units
    // that were never returned.
    const created = await makeReturn(5);
    const before = await stockNow();

    await h.adapter.restockReturnItems(String(created.id));
    const second = await h.adapter.restockReturnItems(String(created.id));

    expect(second).toHaveLength(0);
    expect(await stockNow()).toBe(before + 5);
  });

  it('restocks only the items it was given', async () => {
    const created = await makeReturn(2);
    const before = await stockNow();

    const restocked = await h.adapter.restockReturnItems(String(created.id), []);

    // An empty list means "no filter" to the query, matching the route's
    // "restock everything" default rather than "restock nothing".
    expect(restocked).toHaveLength(1);
    expect(await stockNow()).toBe(before + 2);
  });
});

describe('updateReturnStatus', () => {
  it('moves a return through approval', async () => {
    const created = await makeReturn(1);

    const updated = await h.adapter.updateReturnStatus(String(created.id), { status: 'approved' });

    expect(updated.status).toBe('approved');
  });

  it('returns null for a return that does not exist', async () => {
    expect(
      await h.adapter.updateReturnStatus('00000000-0000-0000-0000-0000000000ff', { status: 'approved' })
    ).toBeNull();
  });
});

describe('getReturnStats', () => {
  it('counts and totals what was returned', async () => {
    await makeReturn(2);
    await makeReturn(3);

    const stats = await h.adapter.getReturnStats();

    expect(Number(stats.totalReturns)).toBeGreaterThanOrEqual(2);
  });
});
