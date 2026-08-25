import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, cleanup, tag, type Harness } from './harness';

/**
 * Order and stock SQL against a real Postgres.
 *
 * This is the money path. `createOrder` writes across `orders`, `order_items`,
 * and `payments` in one transaction and decrements stock conditionally; none of
 * that is observable through a mocked adapter, and the conditional decrement in
 * particular exists to survive concurrency, which only a real database can
 * demonstrate.
 */
let h: Harness;
const mark = tag();
let productId: string;
let variantId: string;

/** A minimal sale of `quantity` units, priced at $5 each. */
function sale(quantity: number, extras: Record<string, unknown> = {}) {
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
    ...extras,
  };
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
  const variant = await h.adapter.createVariant(productId, { sku: `${mark}-T`, stock: 10 });
  variantId = String(variant!.id);
}, 30_000);

afterAll(async () => {
  await cleanup(h, mark);
  await h.close();
});

describe('createOrder', () => {
  it('writes the order, its items, and its payments together', async () => {
    const order = await h.adapter.createOrder(sale(2));

    const { rows: items } = await h.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
    const { rows: payments } = await h.query('SELECT * FROM payments WHERE order_id = $1', [order.id]);

    expect(items).toHaveLength(1);
    expect(payments).toHaveLength(1);
    expect(Number(payments[0].amount)).toBe(10);
  });

  it('stores money exactly, with no floating-point drift', async () => {
    // Prices are held in cents through the service layer; this confirms the
    // column round-trips the value rather than storing a float approximation.
    const order = await h.adapter.createOrder({ ...sale(1), subtotal: 0.1, total: 0.3, taxTotal: 0.2 });

    const fetched = await h.adapter.getOrderById(String(order.id));
    expect(fetched!.total).toBe(0.3);
    expect(fetched!.taxTotal).toBe(0.2);
  });

  it('decrements stock by what was sold', async () => {
    const before = await stockNow();

    await h.adapter.createOrder(sale(3));

    expect(await stockNow()).toBe(before - 3);
  });

  it('reads back with its items attached', async () => {
    const order = await h.adapter.createOrder(sale(1));

    const fetched = await h.adapter.getOrderById(String(order.id));
    expect((fetched!.items as unknown[]).length).toBe(1);
    expect((fetched!.items as Record<string, unknown>[])[0].nameSnapshot).toBe(`${mark} Tea`);
  });

  it('records cash tendered and change', async () => {
    const order = await h.adapter.createOrder(sale(1, { amountTendered: 20, changeGiven: 15 }));

    const fetched = await h.adapter.getOrderById(String(order.id));
    expect(fetched!.amountTendered).toBe(20);
    expect(fetched!.changeGiven).toBe(15);
  });
});

describe('stock under concurrency', () => {
  it('does not oversell when sales race for the last units', async () => {
    // The decrement is a conditional UPDATE (`WHERE stock >= n`) rather than a
    // read-then-write precisely so two tills cannot both pass the check and
    // then both subtract. A mocked adapter cannot show this; two real
    // connections can.
    await h.query('UPDATE product_variants SET stock = 5 WHERE id = $1', [variantId]);

    const results = await Promise.allSettled([
      h.adapter.createOrder(sale(4)),
      h.adapter.createOrder(sale(4)),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const stock = await stockNow();

    // Whatever the interleaving, stock must never go negative and the two sales
    // must not both have been allowed to take 4 from 5.
    expect(stock).toBeGreaterThanOrEqual(0);
    expect(succeeded * 4).toBeLessThanOrEqual(5 + stock);
  });

  it('never leaves stock negative', async () => {
    await h.query('UPDATE product_variants SET stock = 1 WHERE id = $1', [variantId]);

    await Promise.allSettled([h.adapter.createOrder(sale(1)), h.adapter.createOrder(sale(1))]);

    expect(await stockNow()).toBeGreaterThanOrEqual(0);
  });
});

async function stockNow(): Promise<number> {
  const { rows } = await h.query('SELECT stock FROM product_variants WHERE id = $1', [variantId]);
  return Number(rows[0].stock);
}

describe('EMV receipt fields', () => {
  /**
   * Card networks require certain fields on the receipt for a chip payment, so
   * losing them is a compliance failure rather than a cosmetic one — and the
   * failure mode is silent: the receipt simply prints without them.
   *
   * Exercised against real SQL because the risk here is arity. Adding a column
   * to a positional INSERT without adding its placeholder shifts every
   * parameter after it, and the row still writes.
   */
  // The file shares one variant and earlier cases spend its stock, so this
  // block tops it up rather than failing on an unrelated shortage.
  beforeAll(async () => {
    await h.query('UPDATE product_variants SET stock = 100 WHERE id = $1', [variantId]);
  });

  const receipt = {
    accountType: 'credit',
    applicationPreferredName: 'Visa Credit',
    dedicatedFileName: 'A0000000031010',
    authorizationCode: '123456',
    authorizationResponseCode: '00',
    applicationCryptogram: 'A1B2C3D4E5F60708',
    terminalVerificationResults: '0000008000',
    transactionStatusInformation: 'E800',
    cardholderVerificationMethod: 'online_pin',
  };

  it('keeps the whole block through a round trip', async () => {
    const order = await h.adapter.createOrder({
      ...sale(1),
      paymentMethod: 'Card',
      payments: [{ method: 'card', amount: 5 }],
      cardTransactionId: 'pi_emv',
      cardAuthCode: '123456',
      cardReceipt: receipt,
    });

    const reloaded = await h.adapter.getOrderById(String(order.id));

    expect(reloaded!.cardReceipt).toEqual(receipt);
  });

  it('does not disturb the columns around it', async () => {
    // The arity check. If the placeholder were missing, these would take each
    // other's values rather than failing outright.
    const order = await h.adapter.createOrder({
      ...sale(1),
      paymentMethod: 'Card',
      payments: [{ method: 'card', amount: 5 }],
      cardTransactionId: 'pi_arity',
      cardAuthCode: 'AUTH99',
      cardReceipt: receipt,
      amountTendered: 5,
      changeGiven: 0,
    });

    const reloaded = await h.adapter.getOrderById(String(order.id));

    expect(reloaded).toMatchObject({
      cardTransactionId: 'pi_arity',
      cardAuthCode: 'AUTH99',
      total: 5,
    });
  });

  it('leaves a cash sale with no receipt block at all', async () => {
    const order = await h.adapter.createOrder(sale(1));

    const reloaded = await h.adapter.getOrderById(String(order.id));

    expect(reloaded!.cardReceipt).toBeNull();
  });
});
