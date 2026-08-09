import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Order search — what the receipt lookup screen runs.
 *
 * Every filter here narrows a list a cashier uses to find a specific sale, so a
 * filter that quietly does nothing means handing back the wrong receipt. The
 * text filter goes into a LIKE, which is where the catalog search turned out to
 * be unescaped: a search for `%` matched everything.
 */
let h: Harness;
const mark = tag();

const orderIds: string[] = [];

async function makeOrder(total: number, email: string | null, paymentMethod = 'Cash') {
  const created = await h.adapter.createOrder({
    items: [],
    subtotal: total,
    discountTotal: 0,
    taxTotal: 0,
    total,
    paymentMethod,
    customerEmail: email,
    payments: [{ method: paymentMethod.toLowerCase(), amount: total }],
  });
  orderIds.push(String(created.id));
  return created;
}

/** Only the orders this file created, so other rows cannot skew a count. */
const mine = (rows: Array<Record<string, unknown>>) =>
  rows.filter((row) => orderIds.includes(String(row.id)));

beforeAll(async () => {
  h = await connect();
  await makeOrder(10, `${mark}-ada@example.com`);
  await makeOrder(50, `${mark}-grace@example.com`, 'Card');
  await makeOrder(100, null);
}, 30_000);

afterAll(async () => {
  if (orderIds.length > 0) {
    await h.query('DELETE FROM payments WHERE order_id = ANY($1)', [orderIds]);
    await h.query('DELETE FROM order_items WHERE order_id = ANY($1)', [orderIds]);
    await h.query('DELETE FROM orders WHERE id = ANY($1)', [orderIds]);
  }
  await h.close();
});

describe('filtering', () => {
  it('matches on customer email', async () => {
    const found = await h.adapter.searchOrders({ query: `${mark}-ada` });

    expect(mine(found)).toHaveLength(1);
  });

  it('matches case-insensitively', async () => {
    const found = await h.adapter.searchOrders({ query: `${mark}-ADA`.toUpperCase() });

    expect(mine(found)).toHaveLength(1);
  });

  it('filters by exact email', async () => {
    const found = await h.adapter.searchOrders({ customerEmail: `${mark}-grace@example.com` });

    expect(mine(found)).toHaveLength(1);
  });

  it('filters by minimum amount', async () => {
    const found = await h.adapter.searchOrders({ minAmount: 50 });

    expect(mine(found).map((o) => Number(o.total)).sort((a, b) => a - b)).toEqual([50, 100]);
  });

  it('filters by maximum amount', async () => {
    const found = await h.adapter.searchOrders({ maxAmount: 50 });

    expect(mine(found).map((o) => Number(o.total)).sort((a, b) => a - b)).toEqual([10, 50]);
  });

  it('combines a minimum and a maximum', async () => {
    const found = await h.adapter.searchOrders({ minAmount: 20, maxAmount: 60 });

    expect(mine(found).map((o) => Number(o.total))).toEqual([50]);
  });

  it('filters by payment method', async () => {
    const found = await h.adapter.searchOrders({ paymentMethod: 'Card' });

    expect(mine(found)).toHaveLength(1);
  });

  it('filters by date range', async () => {
    const found = await h.adapter.searchOrders({ startDate: Date.now() - 60_000, endDate: Date.now() + 60_000 });

    expect(mine(found).length).toBeGreaterThanOrEqual(3);
  });

  it('excludes everything outside the date range', async () => {
    const found = await h.adapter.searchOrders({ endDate: Date.now() - 86_400_000 });

    expect(mine(found)).toHaveLength(0);
  });

  it('returns everything when nothing is asked of it', async () => {
    const found = await h.adapter.searchOrders({});

    expect(mine(found)).toHaveLength(3);
  });
});

describe('the text filter', () => {
  it('treats a wildcard as a literal', async () => {
    // Unescaped, `%` matches every row — so a cashier searching for a customer
    // whose address contains one is handed the entire sales history instead.
    const found = await h.adapter.searchOrders({ query: '%' });

    expect(mine(found)).toHaveLength(0);
  });

  it('treats an underscore as a literal', async () => {
    // `_` matches any single character, so `a_a` would match `ada` — a search
    // that silently returns rows the cashier did not ask for.
    const found = await h.adapter.searchOrders({ query: `${mark}-a_a@example.com` });

    expect(mine(found)).toHaveLength(0);
  });

  it('still finds a genuine partial match', async () => {
    const found = await h.adapter.searchOrders({ query: 'grace@example.com' });

    expect(mine(found)).toHaveLength(1);
  });
});

describe('paging', () => {
  it('limits the page', async () => {
    const found = await h.adapter.searchOrders({ query: mark, limit: 2 });

    expect(found.length).toBeLessThanOrEqual(2);
  });

  it('offsets to a different row', async () => {
    const first = await h.adapter.searchOrders({ query: mark, limit: 1, offset: 0 });
    const second = await h.adapter.searchOrders({ query: mark, limit: 1, offset: 1 });

    expect(String(first[0]?.id)).not.toBe(String(second[0]?.id));
  });
});
