import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient, ApiClientError } from '../api-client';

// Mock fetch
global.fetch = vi.fn();

describe('apiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('get', () => {
    it('should make GET request without token', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: '1' } }),
      });

      const result = await apiClient.get('/api/test');

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/test',
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
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

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
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      });

      await expect(apiClient.get('/api/test')).rejects.toThrow(ApiClientError);
    });
  });

  describe('post', () => {
    it('should make POST request with data', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: '1' } }),
      });

      const result = await apiClient.post('/api/test', { name: 'Test' });

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/test',
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
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await apiClient.put('/api/test/1', { name: 'Updated' });

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/test/1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'Updated' }),
        })
      );
    });
  });

  describe('delete', () => {
    it('should make DELETE request', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await apiClient.delete('/api/test/1');

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/test/1',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });
});

