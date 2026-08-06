import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminApi, customersApi, productsApi, returnsApi, uploadApi } from '..';

global.fetch = vi.fn();

function mockResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

/**
 * The path and RequestInit the SDK handed to `fetch` on its most recent call.
 *
 * The base URL is stripped: it comes from `VITE_API_BASE_URL` and is empty in dev
 * (where Vite proxies) but absolute in a built bundle. These tests are about the
 * path the SDK composes, so they should not care which mode the env is in.
 */
function lastCall(): [string, RequestInit] {
  const call = vi.mocked(fetch).mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');

  const base = import.meta.env.VITE_API_BASE_URL || '';
  const url = String(call[0]);

  return [base && url.startsWith(base) ? url.slice(base.length) : url, (call[1] ?? {}) as RequestInit];
}

describe('typed API SDK', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('maps a resource call onto the backend path and method', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ success: true, data: [] }));

    await productsApi.list();

    const [url, init] = lastCall();
    expect(url).toBe('/api/products');
    expect(init.method).toBe('GET');
  });

  it('returns the unwrapped payload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ success: true, data: { id: 'p1', name: 'Widget' } })
    );

    const product = await productsApi.get('p1');

    expect(product).toEqual({ id: 'p1', name: 'Widget' });
  });

  it('escapes path segments that could otherwise break the URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ success: true, data: {} }));

    await uploadApi.remove('logo', 'my logo&v2.png');

    const [url] = lastCall();
    expect(url).toBe('/api/upload/logo/my%20logo%26v2.png');
  });

  it('appends only the query params that were set', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ success: true, data: [] }));

    await returnsApi.list({ status: 'pending', customerId: undefined });

    const [url] = lastCall();
    expect(url).toBe('/api/returns?status=pending');
  });

  it('surfaces the envelope on a failure so callers can read domain fields', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(
        { success: false, error: 'Customer has orders', hasRelatedRecords: true },
        { ok: false, status: 409 }
      )
    );

    await expect(customersApi.remove('c1')).rejects.toMatchObject({
      status: 409,
      message: 'Customer has orders',
      body: { hasRelatedRecords: true },
    });
  });

  it('keeps pagination meta on list endpoints that provide it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ success: true, data: [{ id: 'a1' }], meta: { total: 42, limit: 1 } })
    );

    const { data, meta } = await adminApi.audit({ limit: 1 });

    expect(data).toHaveLength(1);
    expect(meta).toEqual({ total: 42, limit: 1 });
    expect(lastCall()[0]).toBe('/api/admin/audit?limit=1');
  });

  it('sends multipart uploads without a hand-set Content-Type', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ success: true, data: { url: '/uploads/logos/a.png' } })
    );

    await uploadApi.upload('logo', new File(['x'], 'a.png', { type: 'image/png' }));

    const [url, init] = lastCall();
    expect(url).toBe('/api/upload/logo');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).not.toHaveProperty('Content-Type');
  });
});
