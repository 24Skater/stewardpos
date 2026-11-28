import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, cleanup, tag, type Harness } from './harness';

/** The outbox event commits or rolls back with the order that caused it. */
let h: Harness;
const mark = tag();
let productId: string;
let variantId: string;

function sale(quantity: number) {
  return {
    items: [
      {
        productId,
        variantId,
        nameSnapshot: `${mark} Tea`,
        quantity,
        unitPrice: 5,
        lineDiscount: 0,
        lineTotal: 5 * quantity,
      },
    ],
    subtotal: 5 * quantity,
    discountTotal: 0,
    taxTotal: 0,
    total: 5 * quantity,
    paymentMethod: 'Cash',
    payments: [{ method: 'cash', amount: 5 * quantity }],
  };
}

async function countEvents(): Promise<number> {
  const { rows } = await h.query(
    `SELECT COUNT(*)::int AS n FROM outbox_events WHERE payload->>'id' = ANY($1)`,
    [orderIds]
  );
  return Number(rows[0].n);
}
const orderIds: string[] = [];

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
  const variant = await h.adapter.createVariant(productId, { sku: `${mark}-T`, stock: 1 });
  variantId = String(variant!.id);
}, 30_000);

afterAll(async () => {
  await h.query(`DELETE FROM outbox_events WHERE payload->>'id' = ANY($1)`, [orderIds]);
  await cleanup(h, mark);
  await h.close();
});

describe('order.created outbox event', () => {
  it('is written with the order', async () => {
    const order = await h.adapter.createOrder(sale(1));
    orderIds.push(String(order.id));
    expect(await countEvents()).toBe(1);
  });

  it('is rolled back when the order fails', async () => {
    const before = (await h.query('SELECT COUNT(*)::int AS n FROM outbox_events')).rows[0].n;
    // Stock is now 0, so this sale is refused after its rows were inserted.
    await expect(h.adapter.createOrder(sale(5))).rejects.toThrow();
    const after = (await h.query('SELECT COUNT(*)::int AS n FROM outbox_events')).rows[0].n;
    expect(after).toBe(before);
  });
});
