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
let registerId: string;
let locationId: string;
let orgId: string;
const orderIds: string[] = [];
const returnIds: string[] = [];

async function openDrawer(float = 100) {
  return h.adapter.openDrawerSession({ registerId, openingFloat: float, userId: cashier });
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

  const org = await h.query('INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id', [
    `${mark} org`,
    `${mark}-org`,
  ]);
  orgId = String(org.rows[0].id);

  const location = await h.query(
    'INSERT INTO locations (org_id, name, slug) VALUES ($1, $2, $3) RETURNING id',
    [orgId, `${mark} location`, `${mark}-location`]
  );
  locationId = String(location.rows[0].id);

  const register = await h.adapter.createRegister({
    org_id: orgId,
    location_id: locationId,
    name: `${mark} register`,
    register_number: 1,
    display_code: `${mark}-REG-01`,
  });
  if (typeof register === 'string') throw new Error(`expected a register row, got ${register}`);
  registerId = String(register.id);
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
  await h.query('DELETE FROM cash_drawer_sessions WHERE opened_by = $1 OR closed_by = $1 OR register_id = $2', [
    cashier,
    registerId,
  ]);
  await h.query('DELETE FROM registers WHERE id = $1', [registerId]);
  await h.query('DELETE FROM locations WHERE id = $1', [locationId]);
  await h.query('DELETE FROM organizations WHERE id = $1', [orgId]);
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

describe('order & return attribution round trip', () => {
  it('stamps register, cashier and drawer session on a cash order, and register on its payment', async () => {
    const session = await openDrawer(100);

    const order = await h.adapter.createOrder({
      items: [],
      subtotal: 12,
      discountTotal: 0,
      taxTotal: 0,
      total: 12,
      paymentMethod: 'Cash',
      payments: [{ method: 'cash', amount: 12 }],
      registerId,
      cashierUserId: cashier,
      drawerSessionId: session.id,
    });
    orderIds.push(String(order.id));

    const fetched = await h.adapter.getOrderById(String(order.id));
    expect(fetched!.registerId).toBe(registerId);
    expect(fetched!.cashierUserId).toBe(cashier);
    expect(fetched!.drawerSessionId).toBe(String(session.id));
    expect((fetched!.payments as Array<Record<string, unknown>>)[0].registerId).toBe(registerId);

    await h.adapter.closeDrawerSession(String(session.id), 112, 112, cashier);
  });

  it('leaves drawerSessionId unset on a card sale, even with a session open', async () => {
    const session = await openDrawer(100);

    const order = await h.adapter.createOrder({
      items: [],
      subtotal: 12,
      discountTotal: 0,
      taxTotal: 0,
      total: 12,
      paymentMethod: 'Card',
      payments: [{ method: 'card', amount: 12 }],
      registerId,
      cashierUserId: cashier,
      // Deliberately omitted: a card-only sale has no cash leg, so the route
      // never looks up a session to link, regardless of what is open.
    });
    orderIds.push(String(order.id));

    const fetched = await h.adapter.getOrderById(String(order.id));
    expect(fetched!.drawerSessionId).toBeNull();

    await h.adapter.closeDrawerSession(String(session.id), 100, 100, cashier);
  });

  it('stamps register and cashier on a return', async () => {
    const order = await h.adapter.createOrder({
      items: [],
      subtotal: 12,
      discountTotal: 0,
      taxTotal: 0,
      total: 12,
      paymentMethod: 'Card',
      payments: [{ method: 'card', amount: 12 }],
      registerId,
      cashierUserId: cashier,
    });
    orderIds.push(String(order.id));

    const created = await h.adapter.createReturn({
      originalOrderId: order.id,
      returnNumber: `${mark}-ATTR`,
      status: 'pending',
      subtotal: 12,
      taxTotal: 0,
      total: 12,
      items: [],
      registerId,
      cashierUserId: cashier,
    });
    returnIds.push(String(created.id));

    expect(created.registerId).toBe(registerId);
    expect(created.cashierUserId).toBe(cashier);
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
