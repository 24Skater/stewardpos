import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, cleanup, tag, type Harness } from './harness';

/**
 * The reporting aggregations against a real Postgres.
 *
 * This is the task's acceptance criterion: a known set of orders and returns,
 * hand-computed figures, and the report expected to match them exactly. It has
 * to run against a real database — the whole point of moving these sums out of
 * the browser is the SQL, and a mocked adapter would only prove that the service
 * passes a date along.
 *
 * **The dataset is placed in a date window nothing else uses.** These aggregates
 * sum every order in range, so a shared test database would otherwise fold
 * whatever else the suite created into the totals and the figures would drift
 * with the order the files happen to run in. The orders are written normally and
 * then back-dated into January 2001, which no other fixture touches.
 */
let h: Harness;
const mark = tag();
let productId: string;
let variantId: string;
let secondProductId: string;
let secondVariantId: string;

/** The window this file owns. Both ends inclusive, as the adapters read them. */
const RANGE = {
  from: Date.parse('2001-01-01T00:00:00.000Z'),
  to: Date.parse('2001-01-31T23:59:59.999Z'),
};

const DAY_ONE = '2001-01-10T10:00:00.000Z';
const DAY_TWO = '2001-01-11T10:00:00.000Z';

const orderIds: string[] = [];
const returnIds: string[] = [];

interface SaleSpec {
  product?: 'first' | 'second';
  quantity: number;
  unitPrice: number;
  discountTotal?: number;
  taxTotal?: number;
  paymentMethod?: string;
  payments?: { method: string; amount: number }[];
  at: string;
}

/**
 * Write a sale and back-date it.
 *
 * `created_at` is set by the database on insert, so the date is applied with a
 * follow-up UPDATE rather than passed in — `createOrder` has no parameter for
 * it, and inventing one purely for tests would put a way to falsify a sale's
 * date into production code.
 */
async function sale(spec: SaleSpec): Promise<string> {
  const useSecond = spec.product === 'second';
  const subtotal = spec.unitPrice * spec.quantity;
  const discount = spec.discountTotal ?? 0;
  const tax = spec.taxTotal ?? 0;

  const order = await h.adapter.createOrder({
    items: [
      {
        productId: useSecond ? secondProductId : productId,
        variantId: useSecond ? secondVariantId : variantId,
        nameSnapshot: useSecond ? `${mark} Mug` : `${mark} Tea`,
        quantity: spec.quantity,
        unitPrice: spec.unitPrice,
        lineDiscount: 0,
        lineTotal: subtotal,
      },
    ],
    subtotal,
    discountTotal: discount,
    taxTotal: tax,
    total: subtotal - discount + tax,
    paymentMethod: spec.paymentMethod ?? 'Cash',
    payments: spec.payments,
  });

  const id = String(order.id);
  await h.query('UPDATE orders SET created_at = $2 WHERE id = $1', [id, spec.at]);
  orderIds.push(id);
  return id;
}

async function refund(
  orderId: string,
  total: number,
  status: string,
  reasonCode: string | null,
  at: string
): Promise<void> {
  const created = await h.adapter.createReturn({
    originalOrderId: orderId,
    returnNumber: `${mark}-${returnIds.length}`,
    status,
    subtotal: total,
    taxTotal: 0,
    total,
    reasonCode,
    items: [],
  });

  const id = String(created.id);
  await h.query('UPDATE returns SET created_at = $2 WHERE id = $1', [id, at]);
  returnIds.push(id);
}

beforeAll(async () => {
  h = await connect();

  const tea = await h.adapter.createProduct({
    name: `${mark} Tea`,
    description: mark,
    category: `${mark}Drinks`,
    basePrice: 5,
    variants: [],
  });
  productId = String(tea!.id);
  variantId = String((await h.adapter.createVariant(productId, { sku: `${mark}-T`, stock: 500 }))!.id);

  const mug = await h.adapter.createProduct({
    name: `${mark} Mug`,
    description: mark,
    category: `${mark}Drinks`,
    basePrice: 10,
    variants: [],
  });
  secondProductId = String(mug!.id);
  secondVariantId = String(
    (await h.adapter.createVariant(secondProductId, { sku: `${mark}-M`, stock: 500 }))!.id
  );

  // The known dataset, hand-computed below:
  //
  //   day one   4 x Tea @ $5   = $20.00 gross, $2.00 off, $1.44 tax → $19.44  cash
  //   day one   1 x Mug @ $10  = $10.00 gross,     no discount, no tax → $10.00  split
  //   day two   2 x Tea @ $5   = $10.00 gross, $0.00 off, $0.80 tax → $10.80  card
  //
  //   gross $40.00 · discounts $2.00 · tax $2.24 · net $40.24 · 3 orders
  //
  // The first two carry `payments` rows; the third deliberately does not, which
  // is what an order taken before the `payments` table existed looks like.
  await sale({
    quantity: 4,
    unitPrice: 5,
    discountTotal: 2,
    taxTotal: 1.44,
    payments: [{ method: 'cash', amount: 19.44 }],
    at: DAY_ONE,
  });
  await sale({
    product: 'second',
    quantity: 1,
    unitPrice: 10,
    paymentMethod: 'Split',
    payments: [
      { method: 'cash', amount: 4 },
      { method: 'card', amount: 6 },
    ],
    at: DAY_ONE,
  });
  await sale({
    quantity: 2,
    unitPrice: 5,
    taxTotal: 0.8,
    paymentMethod: 'Card',
    at: DAY_TWO,
  });

  // One completed refund of $5.44 and one still pending at $10, so the two are
  // demonstrably treated differently.
  await refund(orderIds[0], 5.44, 'completed', 'defective', DAY_TWO);
  await refund(orderIds[1], 10, 'pending', 'not_needed', DAY_TWO);

  // Outside the window on purpose: proof the range is actually applied rather
  // than every order being summed.
  await sale({ quantity: 100, unitPrice: 5, at: '2001-03-01T10:00:00.000Z' });
}, 60_000);

afterAll(async () => {
  if (returnIds.length > 0) {
    await h.query('DELETE FROM return_items WHERE return_id = ANY($1::uuid[])', [returnIds]);
    await h.query('DELETE FROM returns WHERE id = ANY($1::uuid[])', [returnIds]);
  }
  if (orderIds.length > 0) {
    await h.query('DELETE FROM payments WHERE order_id = ANY($1::uuid[])', [orderIds]);
    await h.query('DELETE FROM order_items WHERE order_id = ANY($1::uuid[])', [orderIds]);
    await h.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orderIds]);
  }
  await cleanup(h, mark);
  await h.close();
});

describe('getSalesTotals', () => {
  it('matches the hand-computed figures for the seeded dataset', async () => {
    const totals = await h.adapter.getSalesTotals(RANGE);

    expect(totals).toEqual({
      orderCount: 3,
      gross: 40,
      discounts: 2,
      tax: 2.24,
      net: 40.24,
    });
  });

  it('reconciles: gross less discounts plus tax is the net', async () => {
    const t = await h.adapter.getSalesTotals(RANGE);

    expect(Math.round((t.gross - t.discounts + t.tax) * 100)).toBe(Math.round(t.net * 100));
  });

  it('leaves out the sale dated outside the range', async () => {
    // $500 of tea in March. If the predicate were dropped this would be
    // impossible to miss.
    const totals = await h.adapter.getSalesTotals(RANGE);

    expect(totals.gross).toBe(40);
  });

  it('returns zeroes for an empty range rather than nulls', async () => {
    // SUM() over no rows is NULL in SQL. Without the COALESCE this reaches the
    // UI as null and renders as "$NaN" on a report card.
    const totals = await h.adapter.getSalesTotals({
      from: Date.parse('1995-01-01T00:00:00.000Z'),
      to: Date.parse('1995-01-02T00:00:00.000Z'),
    });

    expect(totals).toEqual({ orderCount: 0, gross: 0, discounts: 0, tax: 0, net: 0 });
  });
});

describe('getSalesByDay', () => {
  it('groups by calendar day, in order', async () => {
    const days = await h.adapter.getSalesByDay(RANGE);

    expect(days).toEqual([
      { date: '2001-01-10', orderCount: 2, gross: 30, net: 29.44 },
      { date: '2001-01-11', orderCount: 1, gross: 10, net: 10.8 },
    ]);
  });

  it('adds up to the same net as the summary', async () => {
    // The two are read side by side on one screen; a chart that does not add up
    // to the card above it is worse than no chart.
    const [days, totals] = await Promise.all([
      h.adapter.getSalesByDay(RANGE),
      h.adapter.getSalesTotals(RANGE),
    ]);

    const summed = days.reduce((cents, day) => cents + Math.round(day.net * 100), 0);
    expect(summed).toBe(Math.round(totals.net * 100));
  });
});

describe('getTopProducts', () => {
  it('ranks by revenue and sums quantity across orders', async () => {
    const top = await h.adapter.getTopProducts(RANGE, 10);

    expect(top).toEqual([
      { productId, name: `${mark} Tea`, quantity: 6, revenue: 30 },
      { productId: secondProductId, name: `${mark} Mug`, quantity: 1, revenue: 10 },
    ]);
  });

  it('honours the limit', async () => {
    expect(await h.adapter.getTopProducts(RANGE, 1)).toHaveLength(1);
  });

  it('sums line totals to the gross of the range', async () => {
    const top = await h.adapter.getTopProducts(RANGE, 100);
    const totals = await h.adapter.getSalesTotals(RANGE);

    const summed = top.reduce((cents, row) => cents + Math.round(row.revenue * 100), 0);
    expect(summed).toBe(Math.round(totals.gross * 100));
  });
});

describe('getPaymentMix', () => {
  it('splits a split-tender sale across its methods', async () => {
    const mix = await h.adapter.getPaymentMix(RANGE);
    const byMethod = new Map(mix.map((row) => [row.method, row]));

    // The $10 mug was $4 cash and $6 card.
    expect(byMethod.get('card')).toEqual({ method: 'card', count: 2, amount: 16.8 });
    expect(byMethod.get('cash')).toEqual({ method: 'cash', count: 2, amount: 23.44 });
  });

  it('counts an order with no payment rows once, at its own method', async () => {
    // The third order has no `payments` rows, which is what everything sold
    // before that table existed looks like. Reading only `payments` would report
    // a shop's whole history before the upgrade as paid by nothing; letting both
    // branches match would count it twice. Its $10.80 has to appear exactly once.
    const mix = await h.adapter.getPaymentMix(RANGE);
    const card = mix.find((row) => row.method === 'card');

    expect(card).toEqual({ method: 'card', count: 2, amount: 16.8 });
  });

  it('adds up to the net takings, so no sale is missed or double-counted', async () => {
    const mix = await h.adapter.getPaymentMix(RANGE);
    const totals = await h.adapter.getSalesTotals(RANGE);

    const tendered = mix.reduce((cents, row) => cents + Math.round(row.amount * 100), 0);
    expect(tendered).toBe(Math.round(totals.net * 100));
  });
});

describe('getReturnsTotals', () => {
  it('counts only completed refunds as money out', async () => {
    const totals = await h.adapter.getReturnsTotals(RANGE);

    expect(totals).toEqual({
      returnCount: 1,
      refunded: 5.44,
      pendingCount: 1,
      pendingAmount: 10,
    });
  });
});

describe('getReturnsByReason', () => {
  it('breaks the completed refunds down by reason', async () => {
    const byReason = await h.adapter.getReturnsByReason(RANGE);

    expect(byReason).toEqual([{ reasonCode: 'defective', returnCount: 1, refunded: 5.44 }]);
  });

  it('labels a refund with no reason rather than dropping it', async () => {
    // GROUP BY on a NULL column would produce a row keyed on null, which
    // serialises to a chart segment with no name.
    await refund(orderIds[2], 1, 'completed', null, DAY_TWO);

    const byReason = await h.adapter.getReturnsByReason(RANGE);
    const unspecified = byReason.find((row) => row.reasonCode === 'unspecified');

    expect(unspecified).toEqual({ reasonCode: 'unspecified', returnCount: 1, refunded: 1 });
  });
});
