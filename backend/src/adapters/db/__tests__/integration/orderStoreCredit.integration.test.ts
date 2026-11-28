import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Paying for an order with store credit, inside `createOrder`'s transaction.
 *
 * The redemption is a conditional UPDATE in the same transaction as the order,
 * so a sale and the credit it spent either both happen or neither does. These
 * check the arithmetic on `remaining_amount`, the flip to `used` at zero, and —
 * the part only a real database can show — that a refused redemption rolls the
 * whole order back rather than leaving a sale recorded against credit that was
 * never taken.
 */
let h: Harness;
const mark = tag();
const email = `${mark}@example.com`;
const codes: string[] = [];

beforeAll(async () => {
  h = await connect();
}, 30_000);

afterAll(async () => {
  await h.query('DELETE FROM store_credits WHERE code = ANY($1)', [codes]);
  const orders = 'SELECT id FROM orders WHERE customer_email = $1';
  await h.query(`DELETE FROM payments WHERE order_id IN (${orders})`, [email]);
  await h.query(`DELETE FROM order_items WHERE order_id IN (${orders})`, [email]);
  await h.query('DELETE FROM orders WHERE customer_email = $1', [email]);
  await h.close();
});

async function credit(amount: number, extras: Record<string, unknown> = {}): Promise<string> {
  const code = `${mark}-${codes.length}`.toUpperCase();
  codes.push(code);
  await h.adapter.createStoreCredit({
    code,
    originalAmount: amount,
    remainingAmount: amount,
    customerId: null,
    customerEmail: null,
    returnId: null,
    expiresAt: null,
    status: 'active',
    ...extras,
  });
  return code;
}

const orderPaidWith = (total: number, payments: Array<Record<string, unknown>>) =>
  h.adapter.createOrder({
    items: [],
    subtotal: total,
    discountTotal: 0,
    taxTotal: 0,
    total,
    paymentMethod: 'Split',
    customerEmail: email,
    payments,
  });

const creditRow = async (code: string) =>
  (await h.query('SELECT remaining_amount_cents, status, used_order_id, used_at FROM store_credits WHERE code = $1', [code]))
    .rows[0];

const orderCount = async () =>
  Number((await h.query('SELECT COUNT(*)::int AS n FROM orders WHERE customer_email = $1', [email])).rows[0].n);

describe('store credit as tender', () => {
  it('spends part of a credit, leaving it active with the remainder', async () => {
    const code = await credit(50);

    const order = await orderPaidWith(30, [
      { method: 'store_credit', amount: 20, reference: code.toLowerCase() },
      { method: 'cash', amount: 10 },
    ]);

    const row = await creditRow(code);
    expect(Number(row.remaining_amount_cents)).toBe(3000);
    expect(row.status).toBe('active');
    expect(row.used_at).toBeNull();
    expect(String(row.used_order_id)).toBe(String(order.id));
    expect((order.payments as unknown[]).length).toBe(2);
  });

  it('marks a credit used once it is spent to zero', async () => {
    const code = await credit(12.5);

    await orderPaidWith(12.5, [{ method: 'store_credit', amount: 12.5, reference: code }]);

    const row = await creditRow(code);
    expect(Number(row.remaining_amount_cents)).toBe(0);
    expect(row.status).toBe('used');
    expect(row.used_at).toBeTruthy();
  });

  it('refuses to overspend a credit, and records no order at all', async () => {
    const code = await credit(10);
    const before = await orderCount();

    await expect(
      orderPaidWith(15, [{ method: 'store_credit', amount: 15, reference: code }])
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(await orderCount()).toBe(before);
    expect(Number((await creditRow(code)).remaining_amount_cents)).toBe(1000);
  });

  it('refuses an expired credit', async () => {
    const code = await credit(40, { expiresAt: Date.now() - 60_000 });

    await expect(
      orderPaidWith(5, [{ method: 'store_credit', amount: 5, reference: code }])
    ).rejects.toThrow('not available');
    expect(Number((await creditRow(code)).remaining_amount_cents)).toBe(4000);
  });

  it('refuses a credit that has already been used up', async () => {
    const code = await credit(5, { status: 'used' });

    await expect(
      orderPaidWith(5, [{ method: 'store_credit', amount: 5, reference: code }])
    ).rejects.toThrow('not available');
  });

  it('refuses an unknown code', async () => {
    await expect(
      orderPaidWith(5, [{ method: 'store_credit', amount: 5, reference: `${mark}-NOPE` }])
    ).rejects.toThrow('not available');
  });
});
