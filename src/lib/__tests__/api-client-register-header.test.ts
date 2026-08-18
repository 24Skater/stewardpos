import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `X-Register-Id` on outgoing requests.
 *
 * This header is the whole contract between the terminal and
 * `backend/src/api/middleware/registerContext.ts`: it decides which till a
 * sale, a refund, and a drawer session are attributed to. Getting it wrong
 * does not fail loudly — it rings the sale against the wrong register and the
 * mistake only surfaces later, in a reconciliation that will not balance.
 *
 * Two behaviours matter equally. Sending it when a register is selected is the
 * obvious one. **Omitting it entirely when none is selected** is the subtle
 * one: the backend falls back to the org's lowest-numbered active register
 * when the header is absent, but rejects it outright when it is present and
 * unresolvable — so sending an empty string would turn every request into a
 * 400 rather than a graceful default.
 */

const ORIGINAL_FETCH = global.fetch;

function mockFetch() {
  // Typed with the real fetch parameters, not `()` — the assertions read
  // `calls[0][1]`, and a zero-arg mock makes that an out-of-range tuple index.
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true, data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** Header lookup is case-insensitive per the spec; normalise before asserting. */
function headersFrom(fetchMock: ReturnType<typeof mockFetch>): Record<string, string> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  const raw = (init?.headers ?? {}) as Record<string, string>;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('X-Register-Id on outgoing requests', () => {
  it('omits the header entirely when no register is selected', async () => {
    const fetchMock = mockFetch();
    const { apiClient } = await import('../api-client');

    await apiClient.get('/api/orders');

    expect(headersFrom(fetchMock)).not.toHaveProperty('x-register-id');
  });

  it('sends the selected register on a read', async () => {
    const { setSelectedRegisterId } = await import('../register-device');
    setSelectedRegisterId('reg-42');

    const fetchMock = mockFetch();
    const { apiClient } = await import('../api-client');

    await apiClient.get('/api/drawer/current');

    expect(headersFrom(fetchMock)['x-register-id']).toBe('reg-42');
  });

  it('sends it on a write, which is where attribution actually matters', async () => {
    const { setSelectedRegisterId } = await import('../register-device');
    setSelectedRegisterId('reg-7');

    const fetchMock = mockFetch();
    const { apiClient } = await import('../api-client');

    await apiClient.post('/api/orders', { items: [] });

    expect(headersFrom(fetchMock)['x-register-id']).toBe('reg-7');
  });

  it('stops sending it once the selection is cleared', async () => {
    const { setSelectedRegisterId, clearSelectedRegisterId } = await import('../register-device');
    setSelectedRegisterId('reg-9');
    clearSelectedRegisterId();

    const fetchMock = mockFetch();
    const { apiClient } = await import('../api-client');

    await apiClient.post('/api/orders', { items: [] });

    // Not merely empty — absent. An empty value would be rejected by the
    // backend instead of falling through to its default register.
    expect(headersFrom(fetchMock)).not.toHaveProperty('x-register-id');
  });

  it('reflects a switch between registers without a reload', async () => {
    const { setSelectedRegisterId } = await import('../register-device');
    setSelectedRegisterId('reg-1');

    const fetchMock = mockFetch();
    const { apiClient } = await import('../api-client');

    await apiClient.get('/api/orders');
    expect(headersFrom(fetchMock)['x-register-id']).toBe('reg-1');

    setSelectedRegisterId('reg-2');
    fetchMock.mockClear();

    await apiClient.get('/api/orders');
    expect(headersFrom(fetchMock)['x-register-id']).toBe('reg-2');
  });
});
