import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `X-Register-Token` on outgoing requests, and what happens when the backend
 * says it's no good.
 *
 * Unlike `X-Register-Id` (the unverified claim any browser can make - see
 * `api-client-register-header.test.ts`), a device token is a real credential
 * minted at pairing (`backend/src/services/registerEnrolment.ts`). The whole
 * point of Phase 3 is that revoking one has to actually stop the device -
 * so a terminal that keeps getting told its token is dead has to notice and
 * go re-pair, not silently keep retrying the same dead credential forever.
 */

const ORIGINAL_FETCH = global.fetch;

function mockFetch(
  response: { success: boolean; error?: string; data?: unknown } = { success: true, data: null },
  init: { status?: number } = {}
) {
  const status = init.status ?? 200;
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(response), {
        status,
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

describe('X-Register-Token on outgoing requests', () => {
  it('omits the header when no device token is stored', async () => {
    const fetchMock = mockFetch();
    const { apiClient } = await import('../api-client');

    await apiClient.get('/api/orders');

    expect(headersFrom(fetchMock)).not.toHaveProperty('x-register-token');
  });

  it('sends the stored device token', async () => {
    const { setDeviceToken } = await import('../register-device');
    setDeviceToken('srt_abcd1234_secret');

    const fetchMock = mockFetch();
    const { apiClient } = await import('../api-client');

    await apiClient.post('/api/orders', { items: [] });

    expect(headersFrom(fetchMock)['x-register-token']).toBe('srt_abcd1234_secret');
  });

  it('sends both X-Register-Id and X-Register-Token when both are present', async () => {
    const { setSelectedRegisterId, setDeviceToken } = await import('../register-device');
    setSelectedRegisterId('reg-42');
    setDeviceToken('srt_abcd1234_secret');

    const fetchMock = mockFetch();
    const { apiClient } = await import('../api-client');

    await apiClient.get('/api/orders');

    const headers = headersFrom(fetchMock);
    expect(headers['x-register-id']).toBe('reg-42');
    expect(headers['x-register-token']).toBe('srt_abcd1234_secret');
  });

  it('stops sending it once the token is cleared', async () => {
    const { setDeviceToken, clearDeviceToken } = await import('../register-device');
    setDeviceToken('srt_abcd1234_secret');
    clearDeviceToken();

    const fetchMock = mockFetch();
    const { apiClient } = await import('../api-client');

    await apiClient.get('/api/orders');

    expect(headersFrom(fetchMock)).not.toHaveProperty('x-register-token');
  });
});

describe('a 401 that identifies a bad X-Register-Token', () => {
  const original = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, pathname: '/pos', assign: vi.fn() },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  it('clears the device token and routes to /pair, distinct from an ordinary session 401', async () => {
    const { setDeviceToken, getDeviceToken } = await import('../register-device');
    setDeviceToken('srt_revoked_secret');

    const fetchMock = mockFetch(
      { success: false, error: 'X-Register-Token is invalid or has been revoked' },
      { status: 401 }
    );
    const { apiClient, ApiClientError } = await import('../api-client');

    await expect(apiClient.post('/api/registers/reg-1/heartbeat')).rejects.toBeInstanceOf(ApiClientError);

    expect(getDeviceToken()).toBeNull();
    expect(window.location.assign).toHaveBeenCalledWith('/pair');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('also routes to /pair when the token belongs to another org', async () => {
    const { setDeviceToken, getDeviceToken } = await import('../register-device');
    setDeviceToken('srt_wrong_org_secret');

    mockFetch({ success: false, error: 'X-Register-Token does not belong to your organization' }, { status: 401 });
    const { apiClient, ApiClientError } = await import('../api-client');

    await expect(apiClient.get('/api/orders')).rejects.toBeInstanceOf(ApiClientError);

    expect(getDeviceToken()).toBeNull();
    expect(window.location.assign).toHaveBeenCalledWith('/pair');
  });

  it('does not redirect to /pair a second time when already there', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, pathname: '/pair', assign: vi.fn() },
    });
    const { setDeviceToken } = await import('../register-device');
    setDeviceToken('srt_revoked_secret');

    mockFetch({ success: false, error: 'X-Register-Token is invalid or has been revoked' }, { status: 401 });
    const { apiClient, ApiClientError } = await import('../api-client');

    await expect(apiClient.get('/api/orders')).rejects.toBeInstanceOf(ApiClientError);

    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('leaves an ordinary user-session 401 to the /login path instead, and keeps the device token', async () => {
    const { setDeviceToken, getDeviceToken } = await import('../register-device');
    const { authStore } = await import('../auth-store');
    authStore.setToken('stale-user-token');
    setDeviceToken('srt_still_good_secret');

    mockFetch({ success: false, error: 'Session expired' }, { status: 401 });
    const { apiClient, ApiClientError } = await import('../api-client');

    await expect(apiClient.get('/api/orders')).rejects.toBeInstanceOf(ApiClientError);

    expect(authStore.getToken()).toBeNull();
    expect(getDeviceToken()).toBe('srt_still_good_secret');
    expect(window.location.assign).toHaveBeenCalledWith('/login');
  });
});
