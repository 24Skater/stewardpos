import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManualTerminalAdapter } from '../ManualTerminalAdapter';

describe('ManualTerminalAdapter', () => {
  let adapter: ManualTerminalAdapter;

  beforeEach(() => {
    adapter = new ManualTerminalAdapter();
    vi.useFakeTimers();
  });

  it('createCharge returns pending status immediately', async () => {
    const promise = adapter.createCharge(700, 'USD', { description: 'test' });
    vi.runAllTimers();
    const result = await promise;
    expect(result.status).toBe('pending');
    expect(result.chargeId).toBeTruthy();
  });

  it('getChargeStatus returns approved after pending', async () => {
    const createPromise = adapter.createCharge(700, 'USD', {});
    vi.runAllTimers();
    const { chargeId } = await createPromise;

    const statusPromise = adapter.getChargeStatus(chargeId);
    vi.runAllTimers();
    const result = await statusPromise;

    expect(result.status).toBe('approved');
    expect(result.authCode).toBe('MANUAL');
  });

  it('cancelCharge sets status to cancelled', async () => {
    const createPromise = adapter.createCharge(700, 'USD', {});
    vi.runAllTimers();
    const { chargeId } = await createPromise;

    await adapter.cancelCharge(chargeId);

    const statusPromise = adapter.getChargeStatus(chargeId);
    vi.runAllTimers();
    const result = await statusPromise;
    expect(result.status).toBe('cancelled');
  });

  it('listReaders returns a mock reader', async () => {
    const readers = await adapter.listReaders();
    expect(readers).toHaveLength(1);
    expect(readers[0].id).toBe('manual-reader-1');
  });

  it('testConnection always succeeds', async () => {
    const result = await adapter.testConnection();
    expect(result.success).toBe(true);
  });
});
