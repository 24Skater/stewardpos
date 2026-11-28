import { describe, it, expect, vi, beforeEach } from 'vitest';

const setSmsConsent = vi.fn();
vi.mock('../../services/database', () => ({ default: { getAdapter: () => ({ setSmsConsent }) } }));

const { twilioHandler, twilioSignature } = await import('../twilioHandler');

const settings = { providers: { sms: { provider: 'twilio', credentials: { authToken: '12345' } } } };
const URL = 'https://pos.example.com/api/webhooks/twilio';

beforeEach(() => {
  setSmsConsent.mockReset();
});

describe('twilio signature', () => {
  // Vector cross-checked with openssl HMAC-SHA1 over the documented string layout.
  it('matches the documented example', () => {
    const params = new URLSearchParams({
      CallSid: 'CA1234567890ABCDE',
      Caller: '+12349013030',
      Digits: '1234',
      From: '+12349013030',
      To: '+18005551212',
    });
    expect(twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', params)).toBe(
      '0/KCTR6DLpKmkAf8muzZqo1nDgQ='
    );
  });

  it('verifies a good signature and rejects a bad one', () => {
    const raw = Buffer.from('MessageSid=SM1&From=%2B15551234567&Body=STOP');
    const sig = twilioSignature('12345', URL, new URLSearchParams(raw.toString()));
    const headers = { host: 'pos.example.com', 'x-twilio-signature': sig };
    expect(twilioHandler.verify(raw, headers, settings)).toBe(true);
    expect(twilioHandler.verify(raw, { ...headers, 'x-twilio-signature': 'nope' }, settings)).toBe(false);
  });

  it('is not configured without a Twilio token', () => {
    expect(twilioHandler.isConfigured({ providers: {} })).toBe(false);
    expect(twilioHandler.isConfigured(settings)).toBe(true);
  });
});

describe('twilio inbound', () => {
  const run = async (body: string) => {
    const event = twilioHandler.parse(Buffer.from(`MessageSid=SM1&From=%2B15551234567&Body=${body}`));
    await twilioHandler.handle(event);
  };

  it('STOP opts the number out', async () => {
    await run('STOP');
    expect(setSmsConsent).toHaveBeenCalledWith('5551234567', 'opted_out', 'twilio_stop');
  });

  it('START opts the number back in', async () => {
    await run('start');
    expect(setSmsConsent).toHaveBeenCalledWith('5551234567', 'opted_in', 'twilio_start');
  });

  it('ignores other replies', async () => {
    await run('hello');
    expect(setSmsConsent).not.toHaveBeenCalled();
  });
});
