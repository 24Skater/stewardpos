import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloverTerminalAdapter } from '../CloverTerminalAdapter';
import { DejavooTerminalAdapter } from '../DejavooTerminalAdapter';
import { VerifoneTerminalAdapter } from '../VerifoneTerminalAdapter';
import { RefundNotSupportedError } from '../errors';
import type { TerminalPort } from '../TerminalPort';

/**
 * The three REST-over-fetch providers. Each test stubs `fetch`, so what is
 * checked is the request each adapter builds (URL, auth header, amount units)
 * and how it maps the provider's vocabulary onto ours — the parts that differ
 * per provider and would silently misbehave against the real API.
 */
interface Case {
  name: string;
  make: () => TerminalPort;
  authHeader: [string, string];
  chargeUrl: string;
  /** What the provider receives for a 1234-cent charge. */
  expectedAmount: unknown;
  chargeResponse: unknown;
  expectedChargeId: string;
  statusUrl: (id: string) => string;
  statusResponse: (provider: string) => unknown;
  approvedWord: string;
  cancelUrl: (id: string) => string;
  cancelMethod: string;
  readersUrl: string;
  readersResponse: unknown;
  expectedReaders: unknown;
}

const cases: Case[] = [
  {
    name: 'Clover',
    make: () => new CloverTerminalAdapter({ apiToken: 'tok', merchantId: 'm1', deviceId: 'dev1' }),
    authHeader: ['Authorization', 'Bearer tok'],
    chargeUrl: 'https://api.clover.com/v3/merchants/m1/remote_pay',
    expectedAmount: 1234,
    chargeResponse: { id: 'ch_1' },
    expectedChargeId: 'ch_1',
    statusUrl: (id) => `https://api.clover.com/v3/merchants/m1/remote_pay/${id}`,
    statusResponse: (word) => ({ result: word, authCode: 'A1', message: 'msg' }),
    approvedWord: 'APPROVED',
    cancelUrl: (id) => `https://api.clover.com/v3/merchants/m1/remote_pay/${id}`,
    cancelMethod: 'DELETE',
    readersUrl: 'https://api.clover.com/v3/merchants/m1/devices',
    readersResponse: { elements: [{ id: 'd1', name: 'Front', online: true }, { id: 'd2' }] },
    expectedReaders: [
      { id: 'd1', label: 'Front', status: 'online' },
      { id: 'd2', label: 'd2', status: 'offline' },
    ],
  },
  {
    name: 'Dejavoo',
    make: () => new DejavooTerminalAdapter({ apiKey: 'key', merchantId: 'm1', terminalId: 't1' }),
    authHeader: ['Authorization', 'Bearer key'],
    chargeUrl: 'https://cloud.dejavoo.com/api/v1/payment/sale',
    expectedAmount: '12.34',
    chargeResponse: { refNum: 'ref_1' },
    expectedChargeId: 'ref_1',
    statusUrl: (id) => `https://cloud.dejavoo.com/api/v1/payment/status/${id}`,
    statusResponse: (word) => ({ result: word.toLowerCase(), authCode: 'A1', message: 'msg' }),
    approvedWord: 'APPROVED',
    cancelUrl: (id) => `https://cloud.dejavoo.com/api/v1/payment/void/${id}`,
    cancelMethod: 'POST',
    readersUrl: 'https://cloud.dejavoo.com/api/v1/terminals?merchantId=m1',
    readersResponse: { terminals: [{ terminalId: 't1', name: 'Till', online: true }, { id: 't2' }] },
    expectedReaders: [
      { id: 't1', label: 'Till', status: 'online' },
      { id: 't2', label: 't2', status: 'offline' },
    ],
  },
  {
    name: 'Verifone',
    make: () => new VerifoneTerminalAdapter({ apiKey: 'key', merchantId: 'm1', terminalId: 't1' }),
    authHeader: ['x-api-key', 'key'],
    chargeUrl: 'https://api.verifone.com/v1/transactions',
    expectedAmount: '12.34',
    chargeResponse: { transactionId: 'tx_1' },
    expectedChargeId: 'tx_1',
    statusUrl: (id) => `https://api.verifone.com/v1/transactions/${id}`,
    statusResponse: (word) => ({ status: word, authorizationCode: 'A1', responseMessage: 'msg' }),
    approvedWord: 'APPROVED',
    cancelUrl: (id) => `https://api.verifone.com/v1/transactions/${id}/void`,
    cancelMethod: 'POST',
    readersUrl: 'https://api.verifone.com/v1/terminals?merchantId=m1',
    readersResponse: { terminals: [{ terminalId: 't1', name: 'Till', status: 'ONLINE' }, { terminalId: 't2' }] },
    expectedReaders: [
      { id: 't1', label: 'Till', status: 'online' },
      { id: 't2', label: 't2', status: 'offline' },
    ],
  },
];

const fetchMock = vi.fn();

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function lastCall(): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url, init };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(cases)('$name terminal adapter', (c) => {
  it('sends a sale with the provider’s auth header and amount units', async () => {
    fetchMock.mockResolvedValueOnce(respond(c.chargeResponse));

    const result = await c.make().createCharge(1234, 'USD', { orderId: 'order-123456789', readerId: 'r9' });

    const { url, init } = lastCall();
    expect(url).toBe(c.chargeUrl);
    expect(init.method).toBe('POST');
    expect(init.headers[c.authHeader[0]]).toBe(c.authHeader[1]);
    const body = JSON.parse(String(init.body));
    expect(body.amount).toEqual(c.expectedAmount);
    expect(JSON.stringify(body)).toContain('r9');
    expect(result).toEqual({ chargeId: c.expectedChargeId, status: 'pending' });
  });

  it('falls back to the configured device when the charge names no reader', async () => {
    fetchMock.mockResolvedValueOnce(respond(c.chargeResponse));

    await c.make().createCharge(500, 'USD', {});

    const body = JSON.stringify(JSON.parse(String(lastCall().init.body)));
    expect(body).toMatch(/dev1|t1/);
  });

  it('maps an approved status and carries the auth code', async () => {
    fetchMock.mockResolvedValueOnce(respond(c.statusResponse(c.approvedWord)));

    const result = await c.make().getChargeStatus('abc');

    expect(lastCall().url).toBe(c.statusUrl('abc'));
    expect(result).toMatchObject({ chargeId: 'abc', status: 'approved', authCode: 'A1', errorMessage: 'msg' });
  });

  it('maps declined and voided statuses', async () => {
    fetchMock.mockResolvedValueOnce(respond(c.statusResponse('DECLINED')));
    fetchMock.mockResolvedValueOnce(respond(c.statusResponse('VOIDED')));
    const adapter = c.make();

    expect((await adapter.getChargeStatus('x')).status).toBe('declined');
    expect((await adapter.getChargeStatus('x')).status).toBe('cancelled');
  });

  it('reports an unrecognised provider status as an error, not as approved', async () => {
    fetchMock.mockResolvedValueOnce(respond(c.statusResponse('SOMETHING_NEW')));

    expect((await c.make().getChargeStatus('x')).status).toBe('error');
  });

  it('cancels through the provider’s void endpoint', async () => {
    fetchMock.mockResolvedValueOnce(respond({}));

    await c.make().cancelCharge('abc');

    expect(lastCall().url).toBe(c.cancelUrl('abc'));
    expect(lastCall().init.method).toBe(c.cancelMethod);
  });

  it('refuses refunds with a typed error', async () => {
    await expect(c.make().refundCharge({ chargeId: 'x', amount: 1 } as never)).rejects.toBeInstanceOf(
      RefundNotSupportedError
    );
  });

  it('lists readers with labels and online state', async () => {
    fetchMock.mockResolvedValueOnce(respond(c.readersResponse));

    const readers = await c.make().listReaders();

    expect(lastCall().url).toBe(c.readersUrl);
    expect(readers).toEqual(c.expectedReaders);
  });

  it('lists no readers when the provider returns none', async () => {
    fetchMock.mockResolvedValueOnce(respond({}));

    expect(await c.make().listReaders()).toEqual([]);
  });

  it('surfaces a non-2xx response as an error carrying status and body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad token', { status: 401 }));

    await expect(c.make().getChargeStatus('x')).rejects.toThrow(`${c.name} API 401: bad token`);
  });

  it('testConnection reports success', async () => {
    fetchMock.mockResolvedValueOnce(respond({}));

    expect(await c.make().testConnection()).toMatchObject({ success: true });
  });

  it('testConnection reports the failure instead of throwing', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));

    expect(await c.make().testConnection()).toEqual({ success: false, message: `${c.name} API 500: nope` });
  });

  it('testConnection reports a non-Error rejection as unknown', async () => {
    fetchMock.mockRejectedValueOnce('socket hang up');

    expect(await c.make().testConnection()).toEqual({ success: false, message: 'Unknown error' });
  });
});

describe('Dejavoo specifics', () => {
  it('truncates the invoice number to the 8 characters the API accepts', async () => {
    fetchMock.mockResolvedValueOnce(respond({ id: 'fallback-id' }));

    const result = await new DejavooTerminalAdapter({ apiKey: 'k', merchantId: 'm', terminalId: 't' }).createCharge(
      100,
      'USD',
      { orderId: 'abcdefghijkl' }
    );

    expect(JSON.parse(String(lastCall().init.body)).invoiceNumber).toBe('abcdefgh');
    expect(result.chargeId).toBe('fallback-id');
  });
});
