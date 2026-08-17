import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connect, cleanup, tag, type Harness } from './harness';

/**
 * Store credit and cash drawer SQL against a real Postgres.
 *
 * Both rely on database guarantees that a mock cannot express: store credit is
 * spent with a conditional UPDATE so two simultaneous redemptions cannot both
 * succeed, and the "one open drawer" rule is a partial unique index rather than
 * an application check.
 */
let h: Harness;
const mark = tag();

/** Codes this file creates, removed in cleanup. */
const codes: string[] = [];
const orderIds: string[] = [];

/** Two distinct registers, so drawer tests can prove per-register isolation. */
let orgId: string;
let locationId: string;
let registerAId: string;
let registerBId: string;

async function credit(amount: number, extras: Record<string, unknown> = {}) {
  const code = `${mark}-${codes.length}`.toUpperCase();
  codes.push(code);
  // `originalAmount`, not `amount` — the column is NOT NULL, so the wrong key
  // fails the insert rather than defaulting.
  return h.adapter.createStoreCredit({
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
}

/**
 * A cash order attributed to a drawer session by `drawer_session_id`, not by
 * timing. `createOrder` does not accept `drawer_session_id` yet (that lands
 * with checkout attribution, a separate task), so it is stamped directly with
 * SQL afterward — the same thing the real checkout path will eventually do at
 * insert time.
 */
async function cashOrderFor(sessionId: string, total: number): Promise<string> {
  const order = await h.adapter.createOrder({
    items: [],
    subtotal: total,
    discountTotal: 0,
    taxTotal: 0,
    total,
    paymentMethod: 'cash',
    payments: [{ method: 'cash', amount: total }],
  });
  const orderId = String(order.id);
  orderIds.push(orderId);
  await h.query('UPDATE orders SET drawer_session_id = $1 WHERE id = $2', [sessionId, orderId]);
  return orderId;
}

beforeAll(async () => {
  h = await connect();

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

  const regA = await h.adapter.createRegister({
    org_id: orgId,
    location_id: locationId,
    name: `${mark} Register A`,
    register_number: 1,
    display_code: `${mark}-REG-A`,
  });
  const regB = await h.adapter.createRegister({
    org_id: orgId,
    location_id: locationId,
    name: `${mark} Register B`,
    register_number: 2,
    display_code: `${mark}-REG-B`,
  });
  if (typeof regA === 'string' || typeof regB === 'string') {
    throw new Error(`expected register rows, got ${regA} / ${regB}`);
  }
  registerAId = String(regA.id);
  registerBId = String(regB.id);
}, 30_000);

afterAll(async () => {
  if (codes.length > 0) {
    await h.query('DELETE FROM store_credits WHERE code = ANY($1)', [codes]);
  }
  // Orders referencing a session via `drawer_session_id` must go first - the
  // FK forbids deleting a session that a surviving order still points to.
  if (orderIds.length > 0) {
    await h.query('DELETE FROM payments WHERE order_id = ANY($1)', [orderIds]);
    await h.query('DELETE FROM order_items WHERE order_id = ANY($1)', [orderIds]);
    await h.query('DELETE FROM orders WHERE id = ANY($1)', [orderIds]);
  }
  await h.query("DELETE FROM cash_drawer_sessions WHERE notes = $1 OR opened_by IS NULL AND status = 'open'", [mark]);
  await h.query('DELETE FROM cash_drawer_sessions WHERE register_id = ANY($1)', [[registerAId, registerBId]]);
  await h.query('DELETE FROM registers WHERE id = ANY($1)', [[registerAId, registerBId]]);
  await h.query('DELETE FROM locations WHERE id = $1', [locationId]);
  await h.query('DELETE FROM organizations WHERE id = $1', [orgId]);
  await cleanup(h, mark);
  await h.close();
});

describe('store credit', () => {
  it('is found by its code, case-insensitively', async () => {
    const created = await credit(25);

    const found = await h.adapter.getStoreCreditByCode(String(created.code).toLowerCase());
    expect(found).toMatchObject({ remainingAmount: 25 });
  });

  it('spends part and leaves the rest active', async () => {
    const created = await credit(50);

    const after = await h.adapter.redeemStoreCredit(String(created.code), 20);

    expect(after).toMatchObject({ remainingAmount: 30, status: 'active' });
  });

  it('marks it used once nothing remains', async () => {
    const created = await credit(10);

    const after = await h.adapter.redeemStoreCredit(String(created.code), 10);

    expect(after).toMatchObject({ remainingAmount: 0, status: 'used' });
  });

  it('refuses to spend more than remains', async () => {
    // The guard is `remaining_amount >= $2` in the UPDATE, not a read-then-check,
    // so it holds under concurrency too.
    const created = await credit(10);

    expect(await h.adapter.redeemStoreCredit(String(created.code), 10.01)).toBeNull();
    expect(await h.adapter.getStoreCreditByCode(String(created.code))).toMatchObject({
      remainingAmount: 10,
    });
  });

  it('cannot be spent twice by two simultaneous redemptions', async () => {
    // The whole reason the balance check lives in the UPDATE. Read-then-write
    // would let both callers see $10 and both subtract it.
    const created = await credit(10);

    const results = await Promise.all([
      h.adapter.redeemStoreCredit(String(created.code), 10),
      h.adapter.redeemStoreCredit(String(created.code), 10),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await h.adapter.getStoreCreditByCode(String(created.code))).toMatchObject({
      remainingAmount: 0,
    });
  });

  it('will not spend an expired credit', async () => {
    const created = await credit(10, { expiresAt: Date.now() - 86_400_000 });

    expect(await h.adapter.redeemStoreCredit(String(created.code), 5)).toBeNull();
  });

  it('will not spend one that is already used', async () => {
    const created = await credit(5);
    await h.adapter.redeemStoreCredit(String(created.code), 5);

    expect(await h.adapter.redeemStoreCredit(String(created.code), 0.01)).toBeNull();
  });

  it('returns null for a code that does not exist', async () => {
    expect(await h.adapter.redeemStoreCredit(`${mark}-NOSUCH`, 1)).toBeNull();
  });
});

describe('cash drawer', () => {
  beforeEach(async () => {
    // Leave no open session behind; each test starts from a clean slate.
    await h.query("UPDATE cash_drawer_sessions SET status = 'closed' WHERE status = 'open'");
  });

  it('opens a session', async () => {
    const session = await h.adapter.openDrawerSession({ registerId: registerAId, openingFloat: 100 });

    expect(session).toMatchObject({ openingFloat: 100, status: 'open', registerId: registerAId });
  });

  it('allows only one open at a time on the same register', async () => {
    // Enforced by a partial unique index, not by an application check — two
    // shifts opening on the same till at once would otherwise both succeed.
    await h.adapter.openDrawerSession({ registerId: registerAId, openingFloat: 100 });

    await expect(
      h.adapter.openDrawerSession({ registerId: registerAId, openingFloat: 50 })
    ).rejects.toThrow(/already.*open/i);
  });

  it('allows two different registers to each hold an open session', async () => {
    // The whole point of migration 016: register_id joined the uniqueness
    // constraint, so Register A having an open drawer must not block
    // Register B from opening its own.
    const sessionA = await h.adapter.openDrawerSession({ registerId: registerAId, openingFloat: 100 });
    const sessionB = await h.adapter.openDrawerSession({ registerId: registerBId, openingFloat: 50 });

    expect(sessionA.status).toBe('open');
    expect(sessionB.status).toBe('open');
    expect(sessionA.id).not.toBe(sessionB.id);
  });

  it('finds the open session for its own register', async () => {
    const opened = await h.adapter.openDrawerSession({ registerId: registerAId, openingFloat: 75 });

    expect(await h.adapter.getOpenDrawerSession(registerAId)).toMatchObject({ id: opened.id });
    // A register with nothing open reports null, even while a sibling
    // register's session is open.
    expect(await h.adapter.getOpenDrawerSession(registerBId)).toBeNull();
  });

  it('reports no open session once closed', async () => {
    await h.adapter.openDrawerSession({ registerId: registerAId, openingFloat: 75 });
    await h.query("UPDATE cash_drawer_sessions SET status = 'closed' WHERE status = 'open'");

    expect(await h.adapter.getOpenDrawerSession(registerAId)).toBeNull();
  });

  it('expects the float alone when nothing has been sold', async () => {
    const session = await h.adapter.openDrawerSession({ registerId: registerAId, openingFloat: 100 });

    expect(await h.adapter.getExpectedDrawerCash(String(session.id))).toBe(100);
  });

  it('attributes expected cash by drawer_session_id, not by time overlap between registers', async () => {
    // This is the regression the join fix guards against. Under the old
    // `o.created_at BETWEEN s.opened_at AND s.closed_at` join, two sessions
    // open at the same time would each sum BOTH registers' cash sales, since
    // both orders fall inside both sessions' open time windows. The fixed
    // join attributes each order to exactly the session it was rung against.
    const sessionA = await h.adapter.openDrawerSession({ registerId: registerAId, openingFloat: 100 });
    const sessionB = await h.adapter.openDrawerSession({ registerId: registerBId, openingFloat: 50 });

    // Concurrent: both sessions are open while both orders are rung, so a
    // time-window join cannot distinguish them - only drawer_session_id can.
    await cashOrderFor(String(sessionA.id), 30);
    await cashOrderFor(String(sessionA.id), 20);
    await cashOrderFor(String(sessionB.id), 15);

    const expectedA = await h.adapter.getExpectedDrawerCash(String(sessionA.id));
    const expectedB = await h.adapter.getExpectedDrawerCash(String(sessionB.id));

    // 100 float + 30 + 20 = 150. If Register B's $15 leaked in via the old
    // time-window join, this would read 165 instead.
    expect(expectedA).toBe(150);
    // 50 float + 15 = 65. If Register A's $50 leaked in, this would read 100.
    expect(expectedB).toBe(65);
  });
});
