import { beforeEach, describe, expect, it, vi } from 'vitest';

const callSibling = vi.fn();
vi.mock('../siblingClient', () => ({ callSibling: (...args: unknown[]) => callSibling(...args) }));

const assertSafeWebhookUrl = vi.fn();
vi.mock('../ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ssrfGuard')>()),
  assertSafeWebhookUrl: (...args: unknown[]) => assertSafeWebhookUrl(...args),
}));

import {
  BACKOFF_MS,
  nextAttemptDelay,
  runDeliveries,
  signPayload,
  type DeliveryMark,
  type DueDelivery,
} from '../webhookDelivery';
import { startJob } from '../jobs';
import { EVENT_CATALOG, enqueueEvent } from '../outbox';

function due(attempts: number): DueDelivery {
  return {
    id: 'd1',
    eventId: 'e1',
    eventType: 'order.created',
    orgId: 'o1',
    payload: { total: 10 },
    createdAt: 1_700_000_000_000,
    attempts,
    url: 'https://example.test/hook',
    secretEnc: 'whsec_test',
  };
}

async function run(attempts: number, override: Partial<DueDelivery> = {}): Promise<DeliveryMark> {
  const marks: DeliveryMark[] = [];
  await runDeliveries(
    {
      claimDueDeliveries: async () => [{ ...due(attempts), ...override }],
      getSettings: async () => ({ providers: {} }),
      markDelivery: async (_id, mark) => {
        marks.push(mark);
      },
    },
    1_700_000_100_000
  );
  return marks[0];
}

describe('webhook delivery', () => {
  beforeEach(() => {
    callSibling.mockReset();
    assertSafeWebhookUrl.mockReset();
    assertSafeWebhookUrl.mockResolvedValue(undefined);
  });

  it('does not send when the guard refuses the URL', async () => {
    assertSafeWebhookUrl.mockRejectedValue(new Error('URL points at a private or reserved address'));
    const mark = await run(0);
    expect(callSibling).not.toHaveBeenCalled();
    expect(mark).toMatchObject({ status: 'failed', lastError: 'URL points at a private or reserved address' });
  });

  it('sends both signatures while the previous secret is still valid', async () => {
    callSibling.mockResolvedValue({ ok: true, status: 200, data: null });
    await run(0, { secretPrevEnc: 'old', secretPrevExpiresAt: 1_700_000_200_000 });
    expect(callSibling.mock.calls[0][0].headers['Steward-Signature']).toMatch(
      /^t=1700000100,v1=[0-9a-f]{64},v1=[0-9a-f]{64}$/
    );
    expect(callSibling.mock.calls[0][0].noRedirect).toBe(true);
  });

  it('drops the previous signature once it has expired', async () => {
    callSibling.mockResolvedValue({ ok: true, status: 200, data: null });
    await run(0, { secretPrevEnc: 'old', secretPrevExpiresAt: 1_700_000_000_000 });
    expect(callSibling.mock.calls[0][0].headers['Steward-Signature']).toMatch(/^t=1700000100,v1=[0-9a-f]{64}$/);
  });

  it('signs t + "." + body with HMAC-SHA256 (known vector)', () => {
    expect(signPayload('secret', 1_700_000_000, '{}')).toBe(
      'b8569b78799ff9e3cbff0fc2d63a33a2b57f3282abd07c37ae5e8e7d79a5f163'
    );
  });

  it('follows the 1m, 5m, 30m, 2h, 12h backoff schedule', () => {
    expect(BACKOFF_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
    expect([1, 2, 3, 4, 5].map(nextAttemptDelay)).toEqual(BACKOFF_MS);
  });

  it('goes dead after the sixth failure', async () => {
    callSibling.mockResolvedValue({ ok: false, status: 500, error: 'HTTP 500' });
    expect((await run(4)).status).toBe('failed');
    expect((await run(5)).status).toBe('dead');
  });

  it('marks success delivered and sends the signature header', async () => {
    callSibling.mockResolvedValue({ ok: true, status: 200, data: null });
    const mark = await run(0);
    expect(mark).toMatchObject({ status: 'delivered', attempts: 1, lastStatusCode: 200 });
    const req = callSibling.mock.calls[0][0];
    expect(req.headers['Steward-Signature']).toMatch(/^t=1700000100,v1=[0-9a-f]{64}$/);
    expect(req.body).toMatchObject({ id: 'e1', type: 'order.created', orgId: 'o1', data: { total: 10 } });
  });
});

describe('startJob', () => {
  it('does not start a run while the previous one is still going', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const timer = startJob('t', 10, () => {
      calls += 1;
      return new Promise<void>(() => undefined);
    });
    await vi.advanceTimersByTimeAsync(100);
    clearInterval(timer);
    vi.useRealTimers();
    expect(calls).toBe(1);
  });
});

describe('enqueueEvent', () => {
  it('rejects types outside the catalog', async () => {
    const adapter = { enqueueOutboxEvent: vi.fn() };
    await expect(enqueueEvent(adapter, 'nope' as never, {})).rejects.toThrow('Unknown event type');
    await enqueueEvent(adapter, 'customer.created', { id: 1 });
    expect(adapter.enqueueOutboxEvent).toHaveBeenCalledWith('customer.created', { id: 1 });
    expect(Object.keys(EVENT_CATALOG)).toHaveLength(3);
  });
});
