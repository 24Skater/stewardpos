import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, type Harness } from './harness';

/**
 * The record that makes a charge traceable to a sale.
 *
 * Exercised against real SQL rather than a mocked adapter, because the whole
 * value of this table is what survives when a request does not: the columns,
 * the constraint, and the partial index are the behaviour.
 */

let h: Harness;

beforeAll(async () => {
  h = await connect();
});

afterAll(async () => {
  await h.close();
});

async function anAttempt(overrides: Record<string, unknown> = {}) {
  return h.adapter.createPaymentAttempt({
    amountCents: 2500,
    currency: 'USD',
    provider: 'stripe',
    cartSnapshot: { items: [{ productId: 'p1', quantity: 2 }], total: 25 },
    ...overrides,
  });
}

describe('payment attempts', () => {
  it('records the server-priced amount in minor units', async () => {
    const attempt = await anAttempt();

    expect(attempt.amountCents).toBe(2500);
    expect(attempt.status).toBe('pending');
    expect(attempt.chargeId).toBeNull();
    expect(attempt.orderId).toBeNull();
  });

  it('keeps the cart so an unreconciled charge says what it was for', async () => {
    // Without this, an authorized row with no order records that a card was
    // charged $25 and nothing whatsoever about what was sold.
    const attempt = await anAttempt();

    const reloaded = await h.adapter.getPaymentAttemptById(attempt.id);

    expect(reloaded?.cartSnapshot).toEqual({
      items: [{ productId: 'p1', quantity: 2 }],
      total: 25,
    });
  });

  it('refuses a non-positive amount at the database, not just in code', async () => {
    // A zero-amount charge is meaningless and a negative one is a refund wearing
    // a disguise. The constraint holds even if a future caller forgets.
    await expect(anAttempt({ amountCents: 0 })).rejects.toThrow();
    await expect(anAttempt({ amountCents: -100 })).rejects.toThrow();
  });

  it('moves through the lifecycle without losing what it already knew', async () => {
    const attempt = await anAttempt();

    const authorized = await h.adapter.updatePaymentAttempt(attempt.id, {
      status: 'authorized',
      chargeId: 'pi_abc123',
    });

    expect(authorized).toMatchObject({
      status: 'authorized',
      chargeId: 'pi_abc123',
      amountCents: 2500,
    });
    // A partial update must not blank the fields it did not mention.
    expect(authorized?.cartSnapshot).not.toBeNull();
  });

  it('stamps updated_at when something changes', async () => {
    const attempt = await anAttempt();
    await new Promise((resolve) => setTimeout(resolve, 15));

    const updated = await h.adapter.updatePaymentAttempt(attempt.id, { status: 'authorized' });

    expect(updated!.updatedAt).toBeGreaterThan(attempt.updatedAt);
  });

  it('returns the row unchanged when there is nothing to update', async () => {
    const attempt = await anAttempt();

    const updated = await h.adapter.updatePaymentAttempt(attempt.id, {});

    expect(updated).toMatchObject({ id: attempt.id, status: 'pending' });
  });

  it('reports a missing attempt as missing rather than throwing', async () => {
    const absent = await h.adapter.getPaymentAttemptById(
      '00000000-0000-0000-0000-0000000000ff'
    );

    expect(absent).toBeNull();
  });

  it('finds charges that were authorized but never became an order', async () => {
    // This is the reconciliation question the table exists to answer.
    const stranded = await anAttempt({ amountCents: 4200 });
    await h.adapter.updatePaymentAttempt(stranded.id, {
      status: 'authorized',
      chargeId: 'pi_stranded',
    });

    const { rows } = await h.query(
      `SELECT id, amount_cents, charge_id
         FROM payment_attempts
        WHERE status = 'authorized' AND order_id IS NULL`
    );

    expect(rows.map((row) => row.charge_id)).toContain('pi_stranded');
  });
});
