import { describe, it, expect, vi, beforeEach } from 'vitest';

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
  devicesList: vi.fn(),
  locationsList: vi.fn(),
  ctorArgs: [] as unknown[],
}));

vi.mock('square', () => ({
  SquareEnvironment: { Sandbox: 'sandbox', Production: 'production' },
  SquareClient: class {
    terminal = { checkouts: { create: sdk.create, get: sdk.get, cancel: sdk.cancel } };
    devices = { list: sdk.devicesList };
    locations = { list: sdk.locationsList };
    constructor(args: unknown) {
      sdk.ctorArgs.push(args);
    }
  },
}));

import { SquareTerminalAdapter } from '../SquareTerminalAdapter';
import { RefundNotSupportedError } from '../errors';

const make = (sandbox = false) =>
  new SquareTerminalAdapter({ accessToken: 'sq-tok', locationId: 'L1', deviceId: 'dev1', sandbox });

beforeEach(() => {
  vi.clearAllMocks();
  sdk.ctorArgs.length = 0;
});

describe('SquareTerminalAdapter', () => {
  it('picks the sandbox or production environment from config', () => {
    make(true);
    make(false);

    expect(sdk.ctorArgs).toEqual([
      { token: 'sq-tok', environment: 'sandbox' },
      { token: 'sq-tok', environment: 'production' },
    ]);
  });

  it('creates a checkout in integer minor units on the requested device', async () => {
    sdk.create.mockResolvedValueOnce({ checkout: { id: 'co_1' } });

    const result = await make().createCharge(1234, 'USD', { readerId: 'r9', description: 'Order 7' });

    const req = sdk.create.mock.calls[0][0];
    expect(req.checkout.amountMoney).toEqual({ amount: BigInt(1234), currency: 'USD' });
    expect(req.checkout.deviceOptions).toEqual({ deviceId: 'r9' });
    expect(req.checkout.note).toBe('Order 7');
    expect(req.idempotencyKey).toEqual(expect.any(String));
    expect(result).toEqual({ chargeId: 'co_1', status: 'pending' });
  });

  it('uses the configured device when no reader is named', async () => {
    sdk.create.mockResolvedValueOnce({ checkout: { id: 'co_1' } });

    await make().createCharge(100, 'USD', {});

    expect(sdk.create.mock.calls[0][0].checkout.deviceOptions).toEqual({ deviceId: 'dev1' });
  });

  it('throws Square’s error detail when checkout creation fails', async () => {
    sdk.create.mockResolvedValueOnce({ errors: [{ detail: 'Device offline' }] });

    await expect(make().createCharge(100, 'USD', {})).rejects.toThrow('Device offline');
  });

  it('throws a generic message when Square returns neither checkout nor errors', async () => {
    sdk.create.mockResolvedValueOnce({});

    await expect(make().createCharge(100, 'USD', {})).rejects.toThrow('Failed to create checkout');
  });

  it.each([
    ['PENDING', 'pending'],
    ['IN_PROGRESS', 'pending'],
    ['COMPLETED', 'approved'],
    ['CANCELED', 'cancelled'],
    ['CANCEL_REQUESTED', 'cancelled'],
    ['WEIRD', 'error'],
  ])('maps checkout status %s to %s', async (squareStatus, ours) => {
    sdk.get.mockResolvedValueOnce({ checkout: { status: squareStatus, paymentIds: ['pay_1'] } });

    const result = await make().getChargeStatus('co_1');

    expect(sdk.get).toHaveBeenCalledWith({ checkoutId: 'co_1' });
    expect(result).toEqual({ chargeId: 'co_1', status: ours, authCode: 'pay_1' });
  });

  it('throws when the checkout cannot be found', async () => {
    sdk.get.mockResolvedValueOnce({});

    await expect(make().getChargeStatus('nope')).rejects.toThrow('Checkout not found');
  });

  it('cancels the checkout by id', async () => {
    sdk.cancel.mockResolvedValueOnce({});

    await make().cancelCharge('co_1');

    expect(sdk.cancel).toHaveBeenCalledWith({ checkoutId: 'co_1' });
  });

  it('refuses refunds with a typed error', async () => {
    await expect(make().refundCharge({} as never)).rejects.toBeInstanceOf(RefundNotSupportedError);
  });

  it('maps device status categories onto reader status', async () => {
    sdk.devicesList.mockResolvedValueOnce({
      data: [
        { id: 'd1', attributes: { name: 'Front' }, status: { category: 'AVAILABLE' } },
        { id: 'd2', attributes: {}, status: { category: 'NEEDS_ATTENTION' } },
        { attributes: { manufacturersId: 'm3' }, status: { category: 'OFFLINE' } },
        { id: 'd4', attributes: {} },
      ],
    });

    expect(await make().listReaders()).toEqual([
      { id: 'd1', label: 'Front', status: 'online' },
      { id: 'd2', label: 'd2', status: 'error' },
      { id: 'm3', label: '', status: 'offline' },
      { id: 'd4', label: 'd4', status: 'offline' },
    ]);
  });

  it('testConnection succeeds when locations can be listed', async () => {
    sdk.locationsList.mockResolvedValueOnce({});

    expect(await make().testConnection()).toEqual({ success: true, message: 'Connected to Square' });
  });

  it('testConnection reports a failure instead of throwing', async () => {
    sdk.locationsList.mockRejectedValueOnce(new Error('401 Unauthorized'));
    sdk.locationsList.mockRejectedValueOnce('boom');

    expect(await make().testConnection()).toEqual({ success: false, message: '401 Unauthorized' });
    expect(await make().testConnection()).toEqual({ success: false, message: 'Unknown error' });
  });
});
