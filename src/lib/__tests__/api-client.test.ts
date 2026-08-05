import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient, ApiClientError } from '../api-client';

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

  describe('get', () => {
    it('should make GET request without token', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ success: true, data: { id: '1' } }));

      const result = await apiClient.get('/api/test');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/test'),
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
      expect(result).toEqual({ success: true, data: { id: '1' } });
    });

    it('should include token in headers when available', async () => {
      localStorage.setItem('auth_token', 'test-token');
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ success: true }));

      await apiClient.get('/api/test');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('should throw ApiClientError on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: 'Not found' }, { ok: false, status: 404 }));

      await expect(apiClient.get('/api/test')).rejects.toThrow(ApiClientError);
    });
  });

  describe('post', () => {
    it('should make POST request with data', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ success: true, data: { id: '1' } }));

      const result = await apiClient.post('/api/test', { name: 'Test' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/test'),
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'Test' }),
        })
      );
      expect(result).toEqual({ success: true, data: { id: '1' } });
    });
  });

  describe('put', () => {
    it('should make PUT request with data', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ success: true }));

      await apiClient.put('/api/test/1', { name: 'Updated' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/test/1'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'Updated' }),
        })
      );
    });
  });

  describe('delete', () => {
    it('should make DELETE request', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ success: true }));

      await apiClient.delete('/api/test/1');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/test/1'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });
});

