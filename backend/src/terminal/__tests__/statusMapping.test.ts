import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Translating a payment processor's status into the app's.
 *
 * This is the part of the vendor adapters worth testing without real hardware,
 * and it is money: a status the app reads as `approved` completes a sale and
 * opens the drawer. Map a decline, a cancellation, or an unrecognised state to
 * `approved` and the shop hands over goods for a payment that never landed.
 *
 * The opposite error is safer but still bad — reading a successful payment as
 * pending leaves the customer charged and the sale unrecorded.
 *
 * The live request paths still need real hardware (P3-T5); the mapping does not.
 */
const retrieve = vi.fn();
const create = vi.fn();
const cancel = vi.fn();
const listReaders = vi.fn();

vi.mock('stripe', () => ({
  default: class {
    paymentIntents = { retrieve, create, cancel };
    terminal = { readers: { list: listReaders, processPaymentIntent: vi.fn() } };
  },
}));

const { StripeTerminalAdapter } = await import('../StripeTerminalAdapter');

function adapter() {
  return new StripeTerminalAdapter({ secretKey: 'sk_test', locationId: 'loc', readerId: 'rdr' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Stripe payment intent statuses', () => {
  /** Every status Stripe documents for a payment intent, and what it must mean here. */
  const mappings: Array<[string, string]> = [
    ['succeeded', 'approved'],
    ['canceled', 'cancelled'],
    ['processing', 'pending'],
    ['requires_payment_method', 'pending'],
    ['requires_confirmation', 'pending'],
    ['requires_action', 'pending'],
    ['requires_capture', 'pending'],
  ];

  for (const [stripeStatus, expected] of mappings) {
    it(`maps ${stripeStatus} to ${expected}`, async () => {
      retrieve.mockResolvedValue({ status: stripeStatus, latest_charge: null });

      const result = await adapter().getChargeStatus('pi_1');

      expect(result.status).toBe(expected);
    });
  }

  it('maps an unrecognised status to error, not to approved', async () => {
    // The default matters more than any single mapping: a status Stripe adds
    // later must not be read as a completed payment.
    retrieve.mockResolvedValue({ status: 'some_future_status', latest_charge: null });

    expect((await adapter().getChargeStatus('pi_1')).status).toBe('error');
  });

  it('never reports a failed payment as approved', async () => {
    retrieve.mockResolvedValue({
      status: 'requires_payment_method',
      latest_charge: null,
      last_payment_error: { message: 'Your card was declined.' },
    });

    const result = await adapter().getChargeStatus('pi_1');

    expect(result.status).not.toBe('approved');
    expect(result.errorMessage).toBe('Your card was declined.');
  });

  it('carries the authorisation code through when the card was present', async () => {
    // Printed on the receipt and used to trace a payment with the processor.
    retrieve.mockResolvedValue({
      status: 'succeeded',
      latest_charge: {
        payment_method_details: { card_present: { receipt: { authorization_code: 'A42' } } },
      },
    });

    expect((await adapter().getChargeStatus('pi_1')).authCode).toBe('A42');
  });

  it('copes with an approved charge that carries no auth code', async () => {
    retrieve.mockResolvedValue({ status: 'succeeded', latest_charge: null });

    const result = await adapter().getChargeStatus('pi_1');

    expect(result.status).toBe('approved');
    expect(result.authCode).toBeUndefined();
  });

  it('returns the charge id it was asked about', async () => {
    retrieve.mockResolvedValue({ status: 'succeeded', latest_charge: null });

    expect((await adapter().getChargeStatus('pi_xyz')).chargeId).toBe('pi_xyz');
  });
});

describe('starting a Stripe charge', () => {
  it('reports pending, never approved', async () => {
    // The reader has been asked; the customer has not yet tapped.
    create.mockResolvedValue({ id: 'pi_new' });

    const result = await adapter().createCharge(1250, 'USD', {});

    expect(result).toMatchObject({ chargeId: 'pi_new', status: 'pending' });
  });

  it('sends the amount in the integer cents it was given', async () => {
    create.mockResolvedValue({ id: 'pi_new' });

    await adapter().createCharge(1250, 'USD', {});

    expect(create.mock.calls[0][0]).toMatchObject({ amount: 1250 });
  });

  it('lower-cases the currency, which Stripe requires', async () => {
    create.mockResolvedValue({ id: 'pi_new' });

    await adapter().createCharge(100, 'USD', {});

    expect(create.mock.calls[0][0].currency).toBe('usd');
  });

  it('asks for a card-present payment, not an online one', async () => {
    create.mockResolvedValue({ id: 'pi_new' });

    await adapter().createCharge(100, 'USD', {});

    expect(create.mock.calls[0][0].payment_method_types).toEqual(['card_present']);
  });
});

describe('cancelling', () => {
  it('cancels the payment intent', async () => {
    cancel.mockResolvedValue({});

    await adapter().cancelCharge('pi_1');

    expect(cancel).toHaveBeenCalledWith('pi_1');
  });
});

describe('listing readers', () => {
  it('reports what the processor knows about', async () => {
    listReaders.mockResolvedValue({
      data: [{ id: 'rdr_1', label: 'Front till', status: 'online' }],
    });

    const readers = await adapter().listReaders();

    expect(readers).toHaveLength(1);
    expect(readers[0].id).toBe('rdr_1');
  });

  it('copes with a processor that has none registered', async () => {
    listReaders.mockResolvedValue({ data: [] });

    expect(await adapter().listReaders()).toEqual([]);
  });
});
