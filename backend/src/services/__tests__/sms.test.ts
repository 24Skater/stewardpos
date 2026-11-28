import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSettings = vi.fn();
const getSmsConsent = vi.fn();
const createMessageLog = vi.fn();
const send = vi.fn();

vi.mock('../database', () => ({
  default: { getAdapter: () => ({ getSettings, getSmsConsent, createMessageLog }) },
}));
vi.mock('../../sms/SmsAdapterFactory', async () => {
  const actual = await vi.importActual<typeof import('../../sms/SmsAdapterFactory')>('../../sms/SmsAdapterFactory');
  const { SmsNotConfiguredError } = await import('../../sms/SmsPort');
  return {
    ...actual,
    createSmsAdapter: ({ provider }: { provider: string }) => {
      if (provider === 'off') throw new SmsNotConfiguredError('SMS is off');
      return { send };
    },
  };
});

const { sendSms, inQuietHours } = await import('../sms');

const on = (extra: Record<string, unknown> = {}) => ({
  timezone: 'UTC',
  providers: { sms: { provider: 'http', credentials: {} }, ...extra },
});

beforeEach(() => {
  getSettings.mockReset();
  getSmsConsent.mockReset();
  createMessageLog.mockReset();
  send.mockReset();
  send.mockResolvedValue({ messageId: 'm1' });
});

describe('sendSms', () => {
  it('does not send without consent and logs it suppressed', async () => {
    getSettings.mockResolvedValue(on());
    getSmsConsent.mockResolvedValue(null);

    const result = await sendSms('(555) 123-4567', 'hi', 'test');

    expect(result.status).toBe('suppressed');
    expect(send).not.toHaveBeenCalled();
    expect(createMessageLog).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'sms', recipient: '5551234567', status: 'suppressed' })
    );
  });

  it('does not send to an opted-out number', async () => {
    getSettings.mockResolvedValue(on());
    getSmsConsent.mockResolvedValue('opted_out');
    expect((await sendSms('5551234567', 'hi', 'test')).status).toBe('suppressed');
    expect(send).not.toHaveBeenCalled();
  });

  it('suppresses inside quiet hours', async () => {
    getSettings.mockResolvedValue(on({ smsQuietHours: { start: '00:00', end: '23:59' } }));
    getSmsConsent.mockResolvedValue('opted_in');
    const result = await sendSms('5551234567', 'hi', 'test');
    expect(result).toMatchObject({ status: 'suppressed', detail: 'Inside quiet hours' });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends when consented and outside quiet hours', async () => {
    getSettings.mockResolvedValue(on());
    getSmsConsent.mockResolvedValue('opted_in');
    expect(await sendSms('5551234567', 'hi', 'test')).toMatchObject({ status: 'sent', messageId: 'm1' });
  });

  it('reports unavailable when the provider is off', async () => {
    getSettings.mockResolvedValue({ providers: {} });
    const result = await sendSms('5551234567', 'hi', 'test');
    expect(result).toEqual({ status: 'failed', detail: 'SMS is off' });
    expect(getSmsConsent).not.toHaveBeenCalled();
  });
});

describe('inQuietHours', () => {
  const at = (iso: string) => new Date(iso);

  it('handles a window that spans midnight', () => {
    const quiet = { start: '21:00', end: '08:00' };
    expect(inQuietHours(quiet, 'UTC', at('2026-01-01T23:00:00Z'))).toBe(true);
    expect(inQuietHours(quiet, 'UTC', at('2026-01-01T07:59:00Z'))).toBe(true);
    expect(inQuietHours(quiet, 'UTC', at('2026-01-01T12:00:00Z'))).toBe(false);
  });

  it('reads the clock in the store time zone', () => {
    const quiet = { start: '21:00', end: '08:00' };
    // 03:00Z is 22:00 the previous evening in New York.
    expect(inQuietHours(quiet, 'America/New_York', at('2026-01-02T03:00:00Z'))).toBe(true);
  });

  it('is off when unset', () => {
    expect(inQuietHours(undefined, 'UTC')).toBe(false);
  });
});
