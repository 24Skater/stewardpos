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

beforeAll(async () => {
  h = await connect();
}, 30_000);

afterAll(async () => {
  if (codes.length > 0) {
    await h.query('DELETE FROM store_credits WHERE code = ANY($1)', [codes]);
  }
  await h.query("DELETE FROM cash_drawer_sessions WHERE notes = $1 OR opened_by IS NULL AND status = 'open'", [mark]);
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
    // Leave no open session behind; the exclusivity index is global.
    await h.query("UPDATE cash_drawer_sessions SET status = 'closed' WHERE status = 'open'");
  });

  it('opens a session', async () => {
    const session = await h.adapter.openDrawerSession(100);

    expect(session).toMatchObject({ openingFloat: 100, status: 'open' });
  });

  it('allows only one open at a time', async () => {
    // Enforced by a partial unique index, not by an application check — two
    // tills opening at once would otherwise both succeed.
    await h.adapter.openDrawerSession(100);

    await expect(h.adapter.openDrawerSession(50)).rejects.toThrow(/already open/i);
  });

  it('finds the open session', async () => {
    const opened = await h.adapter.openDrawerSession(75);

    expect(await h.adapter.getOpenDrawerSession()).toMatchObject({ id: opened.id });
  });

  it('reports no open session once closed', async () => {
    await h.adapter.openDrawerSession(75);
    await h.query("UPDATE cash_drawer_sessions SET status = 'closed' WHERE status = 'open'");

    expect(await h.adapter.getOpenDrawerSession()).toBeNull();
  });

  it('expects the float alone when nothing has been sold', async () => {
    const session = await h.adapter.openDrawerSession(100);

    expect(await h.adapter.getExpectedDrawerCash(String(session.id))).toBe(100);
  });
});
