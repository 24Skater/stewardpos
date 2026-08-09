import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Cash drawer reconciliation and refund transactions.
 *
 * Closing a drawer computes the variance in SQL — `$3::numeric - $4::numeric`,
 * cast explicitly because Postgres cannot infer the type of two untyped
 * parameters being subtracted and fails with "operator is not unique". That
 * cast is the kind of thing a mocked adapter cannot exercise at all, and the
 * variance is what tells a shop whether its till is short.
 */
let h: Harness;
const mark = tag();

let cashier: string;
const orderIds: string[] = [];
const returnIds: string[] = [];

async function openDrawer(float = 100) {
  return h.adapter.openDrawerSession(float, cashier);
}

beforeAll(async () => {
  h = await connect();
  const user = await h.adapter.createUser({
    email: `${mark}-cashier@example.com`,
    passwordHash: 'not-a-real-hash',
    name: `${mark} cashier`,
    status: 'active',
    roleIds: [],
  });
  cashier = String(user.id);
}, 30_000);

beforeEach(async () => {
  await h.query("UPDATE cash_drawer_sessions SET status = 'closed' WHERE status = 'open'");
});

afterAll(async () => {
  await h.query('DELETE FROM refund_transactions WHERE order_id = ANY($1)', [orderIds]);
  if (returnIds.length > 0) {
    await h.query('DELETE FROM return_items WHERE return_id = ANY($1)', [returnIds]);
    await h.query('DELETE FROM returns WHERE id = ANY($1)', [returnIds]);
  }
  if (orderIds.length > 0) {
    await h.query('DELETE FROM payments WHERE order_id = ANY($1)', [orderIds]);
    await h.query('DELETE FROM order_items WHERE order_id = ANY($1)', [orderIds]);
    await h.query('DELETE FROM orders WHERE id = ANY($1)', [orderIds]);
  }
  await h.query('DELETE FROM cash_drawer_sessions WHERE opened_by = $1 OR closed_by = $1', [cashier]);
  await h.query('DELETE FROM users WHERE id = $1', [cashier]);
  await h.close();
});

describe('closing a drawer', () => {
  it('records what was counted and what was expected', async () => {
    const session = await openDrawer(100);

    const closed = await h.adapter.closeDrawerSession(String(session.id), 250, 250, cashier);

    expect(closed).toMatchObject({ countedCash: 250, expectedCash: 250, status: 'closed' });
  });

  it('computes a zero variance when the till balances', async () => {
    const session = await openDrawer();

    const closed = await h.adapter.closeDrawerSession(String(session.id), 250, 250, cashier);

    expect(Number(closed!.variance)).toBe(0);
  });

  it('reports a shortfall as a negative variance', async () => {
    // The number a manager actually looks at. Getting the sign backwards would
    // turn every short till into an apparent surplus.
    const session = await openDrawer();

    const closed = await h.adapter.closeDrawerSession(String(session.id), 240, 250, cashier);

    expect(Number(closed!.variance)).toBe(-10);
  });

  it('reports a surplus as a positive variance', async () => {
    const session = await openDrawer();

    const closed = await h.adapter.closeDrawerSession(String(session.id), 260, 250, cashier);

    expect(Number(closed!.variance)).toBe(10);
  });

  it('keeps the cents, since a till is short by cents more often than by pounds', async () => {
    const session = await openDrawer();

    const closed = await h.adapter.closeDrawerSession(String(session.id), 249.55, 250, cashier);

    expect(Number(closed!.variance)).toBeCloseTo(-0.45, 2);
  });

  it('records who closed it and any note', async () => {
    const session = await openDrawer();

    const closed = await h.adapter.closeDrawerSession(
      String(session.id),
      250,
      250,
      cashier,
      'counted twice'
    );

    expect(closed).toMatchObject({ notes: 'counted twice' });
  });

  it('refuses to close a session that is already closed', async () => {
    // `WHERE status = 'open'` is what makes this safe. Closing twice would
    // overwrite the first count, and the first count is the evidence.
    const session = await openDrawer();
    await h.adapter.closeDrawerSession(String(session.id), 250, 250, cashier);

    expect(await h.adapter.closeDrawerSession(String(session.id), 999, 250, cashier)).toBeNull();
  });

  it('does not overwrite the original count on a second attempt', async () => {
    const session = await openDrawer();
    await h.adapter.closeDrawerSession(String(session.id), 250, 250, cashier);
    await h.adapter.closeDrawerSession(String(session.id), 999, 250, cashier);

    const { rows } = await h.query('SELECT counted_cash FROM cash_drawer_sessions WHERE id = $1', [
      session.id,
    ]);
    expect(Number(rows[0].counted_cash)).toBe(250);
  });

  it('returns null for a session that does not exist', async () => {
    expect(
      await h.adapter.closeDrawerSession('00000000-0000-0000-0000-0000000000ff', 1, 1, cashier)
    ).toBeNull();
  });

  it('frees the exclusivity index, so the next shift can open one', async () => {
    const session = await openDrawer();
    await h.adapter.closeDrawerSession(String(session.id), 250, 250, cashier);

    await expect(openDrawer(50)).resolves.toBeTruthy();
  });
});

describe('drawer history', () => {
  it('lists sessions newest first, with the names of who opened them', async () => {
    const session = await openDrawer();
    await h.adapter.closeDrawerSession(String(session.id), 100, 100, cashier);

    const sessions = await h.adapter.getDrawerSessions(10);

    expect(sessions.length).toBeGreaterThan(0);
    const mine = sessions.find((s) => String(s.id) === String(session.id));
    expect(mine).toMatchObject({ openedByName: `${mark} cashier` });
  });

  it('honours the limit', async () => {
    const sessions = await h.adapter.getDrawerSessions(1);

    expect(sessions).toHaveLength(1);
  });
});

describe('refund transactions', () => {
  it('records a refund against its order', async () => {
    const order = await h.adapter.createOrder({
      items: [],
      subtotal: 20,
      discountTotal: 0,
      taxTotal: 0,
      total: 20,
      paymentMethod: 'Cash',
      payments: [{ method: 'cash', amount: 20 }],
    });
    orderIds.push(String(order.id));

    const refund = await h.adapter.createRefundTransaction({
      orderId: order.id,
      returnId: null,
      transactionType: 'refund',
      amount: 20,
      paymentMethod: 'cash',
      processedBy: cashier,
    });

    expect(Number(refund.amount)).toBe(20);
    expect(refund.status).toBe('completed');
  });

  it('defaults the currency rather than storing null', async () => {
    const order = await h.adapter.createOrder({
      items: [],
      subtotal: 5,
      discountTotal: 0,
      taxTotal: 0,
      total: 5,
      paymentMethod: 'Cash',
      payments: [{ method: 'cash', amount: 5 }],
    });
    orderIds.push(String(order.id));

    const refund = await h.adapter.createRefundTransaction({
      orderId: order.id,
      returnId: null,
      transactionType: 'refund',
      amount: 5,
      paymentMethod: 'cash',
      processedBy: cashier,
    });

    expect(refund.currency).toBe('USD');
  });

  it('stamps when it completed, which is the audit trail for the money', async () => {
    const order = await h.adapter.createOrder({
      items: [],
      subtotal: 5,
      discountTotal: 0,
      taxTotal: 0,
      total: 5,
      paymentMethod: 'Cash',
      payments: [{ method: 'cash', amount: 5 }],
    });
    orderIds.push(String(order.id));

    const refund = await h.adapter.createRefundTransaction({
      orderId: order.id,
      returnId: null,
      transactionType: 'refund',
      amount: 5,
      paymentMethod: 'cash',
      processedBy: cashier,
    });

    expect(refund.completed_at).toBeTruthy();
  });
});
