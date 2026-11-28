import { describe, it, expect, beforeEach } from 'vitest';
import { callSibling } from '../siblingClient';
import { startStub, type StubSibling } from '../../test/stubSibling';

let stub: StubSibling | undefined;

beforeEach(async () => {
  await stub?.close();
  stub = undefined;
});

describe('callSibling', () => {
  it('returns ok with status and parsed data on a 200', async () => {
    stub = await startStub({ status: 200, body: { hello: 'world' } });

    const result = await callSibling({ url: `${stub.url}/x`, method: 'POST', body: { a: 1 }, token: 't0k' });

    expect(result).toEqual({ ok: true, status: 200, data: { hello: 'world' } });
    expect(stub.requests[0].method).toBe('POST');
    expect(stub.requests[0].body).toBe('{"a":1}');
    expect(stub.requests[0].headers.authorization).toBe('Bearer t0k');
  });

  it('returns ok false with status on a 500', async () => {
    stub = await startStub({ status: 500, body: { error: 'boom' } });

    const result = await callSibling({ url: stub.url, method: 'GET' });

    expect(result).toEqual({ ok: false, status: 500, error: 'HTTP 500' });
  });

  it('times out a 4000 ms response in under 3.5 s', async () => {
    stub = await startStub({ status: 200, delayMs: 4000 });
    const started = Date.now();

    const result = await callSibling({ url: stub.url, method: 'GET' });

    expect(result.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(3500);
  });

  it('returns ok false when nothing is listening', async () => {
    stub = await startStub();
    const deadUrl = stub.url;
    await stub.close();
    stub = undefined;

    const result = await callSibling({ url: deadUrl, method: 'GET' });

    expect(result.ok).toBe(false);
  });
});
