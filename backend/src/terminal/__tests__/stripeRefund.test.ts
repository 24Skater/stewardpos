import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Refunding through the Stripe adapter.
 *
 * The behaviour under test is the one the returns desk depends on: money
 * actually leaves the merchant's Stripe balance, exactly once, and what the
 * caller is told matches what Stripe said rather than what we hoped.
 */

const refundsCreate = vi.fn();
const paymentIntentsCreate = vi.fn();
const processPaymentIntent = vi.fn();

vi.mock('stripe', () => ({
  default: class {
    refunds = { create: refundsCreate };
    paymentIntents = { create: paymentIntentsCreate, retrieve: vi.fn(), cancel: vi.fn() };
    terminal = { readers: { list: vi.fn(), processPaymentIntent } };
  },
}));

const { StripeTerminalAdapter } = await import('../StripeTerminalAdapter');
const { ManualTerminalAdapter } = await import('../ManualTerminalAdapter');
// Imported here rather than inside the test: pulling in the Square SDK takes
// seconds under a loaded test run, and paying that inside a case makes it fail
// on timing rather than on behaviour.
const { SquareTerminalAdapter } = await import('../SquareTerminalAdapter');
const { RefundNotSupportedError } = await import('../errors');

function adapter() {
  return new StripeTerminalAdapter({
    secretKey: 'sk_test_x',
    locationId: 'tml_1',
    readerId: 'tmr_1',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StripeTerminalAdapter.refundCharge', () => {
  it('refunds the whole payment when no amount is given', async () => {
    refundsCreate.mockResolvedValue({ id: 're_1', status: 'succeeded', amount: 2500 });

    const result = await adapter().refundCharge({ chargeId: 'pi_1' });

    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_1' }),
      expect.anything()
    );
    // Omitting `amount` is what tells Stripe "all of it" — sending a computed
    // total instead would round-trip our own arithmetic through the refund.
    expect(refundsCreate.mock.calls[0][0]).not.toHaveProperty('amount');
    expect(result).toEqual({ refundId: 're_1', status: 'succeeded', amount: 2500 });
  });

  it('passes a partial amount through in minor units', async () => {
    refundsCreate.mockResolvedValue({ id: 're_2', status: 'succeeded', amount: 1000 });

    await adapter().refundCharge({ chargeId: 'pi_1', amount: 1000 });

    expect(refundsCreate.mock.calls[0][0]).toMatchObject({ amount: 1000 });
  });

  it('sends the idempotency key so a retry cannot refund twice', async () => {
    // The failure this prevents is the expensive direction: a network blip on
    // the way back makes the caller retry, and the customer is paid out twice.
    refundsCreate.mockResolvedValue({ id: 're_3', status: 'succeeded', amount: 500 });

    await adapter().refundCharge({ chargeId: 'pi_1', idempotencyKey: 'ret-1:500' });

    expect(refundsCreate.mock.calls[0][1]).toMatchObject({ idempotencyKey: 'ret-1:500' });
  });

  it.each([
    ['succeeded', 'succeeded'],
    ['pending', 'pending'],
    ['requires_action', 'pending'],
    ['failed', 'failed'],
    ['canceled', 'cancelled'],
  ])('maps Stripe status %s to %s', async (stripeStatus, expected) => {
    refundsCreate.mockResolvedValue({ id: 're_4', status: stripeStatus, amount: 100 });

    const result = await adapter().refundCharge({ chargeId: 'pi_1' });

    expect(result.status).toBe(expected);
  });

  it('reports why a refund failed rather than just that it did', async () => {
    refundsCreate.mockResolvedValue({
      id: 're_5',
      status: 'failed',
      amount: 100,
      failure_reason: 'expired_or_canceled_card',
    });

    const result = await adapter().refundCharge({ chargeId: 'pi_1' });

    expect(result).toMatchObject({
      status: 'failed',
      failureReason: 'expired_or_canceled_card',
    });
  });

  it('defaults the reason to a customer request', async () => {
    refundsCreate.mockResolvedValue({ id: 're_6', status: 'succeeded', amount: 100 });

    await adapter().refundCharge({ chargeId: 'pi_1' });

    expect(refundsCreate.mock.calls[0][0]).toMatchObject({ reason: 'requested_by_customer' });
  });
});

describe('adapters with no API-driven refund', () => {
  it('the manual adapter acknowledges the refund, because there is no processor', async () => {
    const result = await new ManualTerminalAdapter().refundCharge({ chargeId: 'manual_1' });

    expect(result.status).toBe('succeeded');
  });

  it('a provider we have not implemented refuses instead of pretending', async () => {
    // Silently returning success here is the exact bug this whole change exists
    // to remove; a clerk needs to be told to refund in the provider's dashboard.
    const square = new SquareTerminalAdapter({
      accessToken: 't',
      locationId: 'l',
      deviceId: 'd',
    });

    await expect(square.refundCharge({ chargeId: 'x' })).rejects.toBeInstanceOf(
      RefundNotSupportedError
    );
  });
});
