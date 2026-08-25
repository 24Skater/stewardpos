import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordChargeOutcome } from '../paymentOutcome';

/**
 * Settling an attempt from whichever feed heard about it.
 *
 * Both a webhook and a poll land here, and the rules have to be identical
 * either way — a hosted install runs mostly on webhooks and a self-hosted one
 * behind NAT runs entirely on polling, so any difference between them would
 * only ever break for half the install base.
 */

const getPaymentAttemptByChargeId = vi.fn();
const updatePaymentAttempt = vi.fn();

const store = { getPaymentAttemptByChargeId, updatePaymentAttempt };

beforeEach(() => {
  vi.clearAllMocks();
  getPaymentAttemptByChargeId.mockResolvedValue({ id: 'att-1', status: 'pending' });
  updatePaymentAttempt.mockResolvedValue({});
});

describe('recordChargeOutcome', () => {
  it('marks an approved charge as authorized', async () => {
    const result = await recordChargeOutcome(store, { chargeId: 'pi_1', status: 'approved' });

    expect(result.applied).toBe(true);
    expect(updatePaymentAttempt).toHaveBeenCalledWith('att-1', { status: 'authorized' });
  });

  it('records why a declined charge failed', async () => {
    await recordChargeOutcome(store, {
      chargeId: 'pi_1',
      status: 'declined',
      failureReason: 'insufficient_funds',
    });

    expect(updatePaymentAttempt).toHaveBeenCalledWith('att-1', {
      status: 'failed',
      failureReason: 'insufficient_funds',
    });
  });

  it('writes nothing while the reader is still waiting for a card', async () => {
    // `pending` is not news. Writing it on every poll would be churn on a row
    // whose updated_at is meant to mean something changed.
    const result = await recordChargeOutcome(store, { chargeId: 'pi_1', status: 'pending' });

    expect(result).toEqual({ applied: false, reason: 'no_change' });
    expect(updatePaymentAttempt).not.toHaveBeenCalled();
  });

  it('will not drag a completed sale back to merely authorized', async () => {
    // Events are not ordered and are redelivered, so a late `succeeded` for a
    // sale that already has an order is ordinary. Applying it would make a
    // finished sale reappear as unreconciled.
    getPaymentAttemptByChargeId.mockResolvedValue({ id: 'att-1', status: 'completed' });

    const result = await recordChargeOutcome(store, { chargeId: 'pi_1', status: 'approved' });

    expect(result).toEqual({ applied: false, reason: 'already_settled' });
    expect(updatePaymentAttempt).not.toHaveBeenCalled();
  });

  it('leaves a failed attempt failed', async () => {
    getPaymentAttemptByChargeId.mockResolvedValue({ id: 'att-1', status: 'failed' });

    const result = await recordChargeOutcome(store, { chargeId: 'pi_1', status: 'approved' });

    expect(result.applied).toBe(false);
    expect(updatePaymentAttempt).not.toHaveBeenCalled();
  });

  it('reports a charge it has no attempt for rather than inventing one', async () => {
    // Either a payment taken outside this till or a row that never got written.
    // Both are worth a human looking at; neither is something to paper over.
    getPaymentAttemptByChargeId.mockResolvedValue(null);

    const result = await recordChargeOutcome(store, { chargeId: 'pi_orphan', status: 'approved' });

    expect(result).toEqual({ applied: false, reason: 'unknown_charge' });
    expect(updatePaymentAttempt).not.toHaveBeenCalled();
  });

  it('is safe to apply twice, because redelivery is normal', async () => {
    await recordChargeOutcome(store, { chargeId: 'pi_1', status: 'approved' });
    getPaymentAttemptByChargeId.mockResolvedValue({ id: 'att-1', status: 'authorized' });
    await recordChargeOutcome(store, { chargeId: 'pi_1', status: 'approved' });

    // The second call is a no-op in effect: same status, same row.
    expect(updatePaymentAttempt).toHaveBeenCalledTimes(2);
    expect(updatePaymentAttempt.mock.calls[1][1]).toEqual({ status: 'authorized' });
  });

  it('treats a terminal error as a failure', async () => {
    await recordChargeOutcome(store, { chargeId: 'pi_1', status: 'error' });

    expect(updatePaymentAttempt).toHaveBeenCalledWith('att-1', { status: 'failed' });
  });

  it('records a cancellation', async () => {
    await recordChargeOutcome(store, { chargeId: 'pi_1', status: 'cancelled' });

    expect(updatePaymentAttempt).toHaveBeenCalledWith('att-1', { status: 'cancelled' });
  });
});
