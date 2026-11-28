import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TwilioSmsAdapter } from '../TwilioSmsAdapter';
import { HttpGatewaySmsAdapter } from '../HttpGatewaySmsAdapter';

/** The two senders: what they put on the wire, and how a refusal reads. */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TwilioSmsAdapter', () => {
  const twilio = new TwilioSmsAdapter({ accountSid: 'AC1', authToken: 'tok', from: '+15550000000' });

  it('posts a form body with basic auth and returns the message sid', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ sid: 'SM1' }), { status: 201 }));

    const result = await twilio.send('5551234567', 'Hello');

    expect(result).toEqual({ messageId: 'SM1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('AC1:tok').toString('base64')}`);
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      To: '+15551234567',
      From: '+15550000000',
      Body: 'Hello',
    });
  });

  it('returns no id when the reply is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));
    expect(await twilio.send('5551234567', 'Hi')).toEqual({ messageId: undefined });
  });

  it('throws with the status and a trimmed reason on a refusal', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(500), { status: 401 }));
    await expect(twilio.send('5551234567', 'Hi')).rejects.toThrow(/^Twilio refused it \(401\): x{200}$/);
  });
});

describe('HttpGatewaySmsAdapter', () => {
  const gateway = new HttpGatewaySmsAdapter({ url: 'https://sms.example.test/send', token: 'secret' });

  it('posts JSON with a bearer token', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 202 }));

    expect(await gateway.send('5551234567', 'Hello')).toEqual({});

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sms.example.test/send');
    expect(init.headers.Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body)).toEqual({ to: '5551234567', body: 'Hello' });
  });

  it('throws with the status on a refusal', async () => {
    fetchMock.mockResolvedValue(new Response('busy', { status: 503 }));
    await expect(gateway.send('5551234567', 'Hi')).rejects.toThrow('The SMS gateway refused it (503): busy');
  });
});
