import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, ApiClientError } from '../api-client';
import { authStore } from '../auth-store';

// Mock fetch
global.fetch = vi.fn();

/**
 * Minimal `Response` stub. `fetch` is typed to resolve to a full Response, but these
 * tests only exercise `ok`, `status` and `json`, so the rest is filled in structurally.
 */
function mockResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

describe('apiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('envelope unwrapping', () => {
    it('returns the payload, not the envelope', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({ success: true, data: { id: '1', name: 'Widget' } })
      );

      const result = await apiClient.get<{ id: string; name: string }>('/api/products/1');

      expect(result).toEqual({ id: '1', name: 'Widget' });
    });

    it('unwraps arrays', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({ success: true, data: [{ id: '1' }, { id: '2' }] })
      );

      const result = await apiClient.get<{ id: string }[]>('/api/products');

      expect(result).toHaveLength(2);
    });

    it('exposes pagination via getList, accepting either meta or pagination', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({
          success: true,
          data: [{ id: '1' }],
          pagination: { total: 9, limit: 20, offset: 0, hasMore: false },
        })
      );

      const { data, meta } = await apiClient.getList<{ id: string }[]>('/api/receipts');

      expect(data).toHaveLength(1);
      expect(meta?.total).toBe(9);
    });
  });

  describe('failure handling', () => {
    it('throws when the body reports success: false, even on HTTP 200', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({ success: false, error: 'This promo code has expired' })
      );

      await expect(apiClient.post('/api/discounts/promos/validate', {})).rejects.toThrow(
        'This promo code has expired'
      );
    });

    it('throws on an HTTP error status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({ success: false, error: 'Product not found' }, { ok: false, status: 404 })
      );

      await expect(apiClient.get('/api/products/nope')).rejects.toMatchObject({
        status: 404,
        message: 'Product not found',
      });
    });

    it('carries the response body so callers can read domain fields off a failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse(
          { success: false, error: 'Customer has orders', hasRelatedRecords: true },
          { ok: false, status: 400 }
        )
      );

      const error = await apiClient
        .delete('/api/customers/1')
        .then(() => null)
        .catch((e: unknown) => e as ApiClientError);

      expect(error).toBeInstanceOf(ApiClientError);
      expect(error?.body?.hasRelatedRecords).toBe(true);
    });

    it('still throws when the body is not valid JSON', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response);

      await expect(apiClient.get('/api/products')).rejects.toBeInstanceOf(ApiClientError);
    });
  });

  describe('401 handling', () => {
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

    it('clears the token and redirects to login', async () => {
      authStore.setToken('stale-token');
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({ success: false, error: 'Invalid token' }, { ok: false, status: 401 })
      );

      await expect(apiClient.get('/api/orders')).rejects.toBeInstanceOf(ApiClientError);

      expect(authStore.getToken()).toBeNull();
      expect(window.location.assign).toHaveBeenCalledWith('/login');
    });

    it('leaves a rejected PIN on the lock screen', async () => {
      // A 401 from the sign-on endpoint means "that PIN was wrong", not "your
      // session expired". Treating it as the latter replaces the lock screen
      // with the login page mid-keystroke — the back-office door this whole
      // feature exists to keep cashiers away from. Found in a browser: the
      // message LockScreen renders for PIN_INVALID could never appear, because
      // the page navigated away first.
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse(
          { success: false, error: 'That PIN was not recognized', code: 'PIN_INVALID' },
          { ok: false, status: 401 }
        )
      );

      await expect(apiClient.post('/api/auth/till', { pin: '000000' })).rejects.toBeInstanceOf(
        ApiClientError
      );

      expect(window.location.assign).not.toHaveBeenCalled();
    });

    it('does not drop a device credential over a rejected PIN', async () => {
      // The terminal is still enrolled; only the person at it typed wrong.
      authStore.setToken('a-till-session');
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse(
          { success: false, error: 'This PIN is locked', code: 'PIN_LOCKED' },
          { ok: false, status: 401 }
        )
      );

      await expect(apiClient.post('/api/auth/till', { pin: '000000' })).rejects.toBeInstanceOf(
        ApiClientError
      );

      expect(authStore.getToken()).toBe('a-till-session');
    });

    it('still sends an unpaired terminal to pair, even from the sign-on endpoint', async () => {
      // The register-token path is a different failure: this device cannot
      // authenticate as itself, and no PIN will fix that.
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse(
          { success: false, error: 'X-Register-Token is required', code: 'REGISTER_TOKEN_INVALID' },
          { ok: false, status: 401 }
        )
      );

      await expect(apiClient.post('/api/auth/till', { pin: '000000' })).rejects.toBeInstanceOf(
        ApiClientError
      );

      expect(window.location.assign).toHaveBeenCalledWith('/pair');
    });

    it('still redirects when an ordinary call 401s', async () => {
      authStore.setToken('stale-token');
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({ success: false, error: 'Invalid token' }, { ok: false, status: 401 })
      );

      await expect(apiClient.post('/api/orders', {})).rejects.toBeInstanceOf(ApiClientError);

      expect(window.location.assign).toHaveBeenCalledWith('/login');
    });

    it('does not redirect when already on the login page', async () => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...original, pathname: '/login', assign: vi.fn() },
      });
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({ success: false, error: 'Invalid credentials' }, { ok: false, status: 401 })
      );

      await expect(apiClient.post('/api/auth/login', {})).rejects.toBeInstanceOf(ApiClientError);

      expect(window.location.assign).not.toHaveBeenCalled();
    });
  });

  describe('requests', () => {
    it('sends the bearer token when one is stored', async () => {
      authStore.setToken('test-token');
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ success: true, data: {} }));

      await apiClient.get('/api/test');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/test'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        })
      );
    });

    it('omits the Authorization header when no token is stored', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ success: true, data: {} }));

      await apiClient.get('/api/test');

      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
    });

    it('serialises the body on POST', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ success: true, data: {} }));

      await apiClient.post('/api/products', { name: 'Widget' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/products'),
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Widget' }) })
      );
    });
  });
});
