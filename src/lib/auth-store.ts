import { apiClient } from './api-client';
import type { LoginResponse } from './api-types';

interface AuthToken {
  token: string;
  expiresAt: number;
}

const TOKEN_KEY = 'auth_token';
const TOKEN_EXPIRY_KEY = 'auth_token_expiry';
const REFRESH_THRESHOLD = 5 * 60 * 1000; // 5 minutes before expiry

export const authStore = {
  setToken(token: string, expiresIn: string = '7d'): void {
    const expiresAt = Date.now() + parseExpiresIn(expiresIn);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_EXPIRY_KEY, expiresAt.toString());
  },

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },

  clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  },

  isTokenExpired(): boolean {
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (!expiry) return true;
    return Date.now() >= parseInt(expiry, 10);
  },

  shouldRefreshToken(): boolean {
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (!expiry) return false;
    const timeUntilExpiry = parseInt(expiry, 10) - Date.now();
    return timeUntilExpiry < REFRESH_THRESHOLD;
  },

  async refreshToken(): Promise<boolean> {
    try {
      const response = await apiClient.post<LoginResponse>('/api/auth/refresh');
      if (response.success && response.data.token) {
        this.setToken(response.data.token, '7d');
        return true;
      }
    } catch (error) {
      this.clearToken();
      return false;
    }
    return false;
  },
};

// Auto-refresh token before expiry (check every minute)
if (typeof window !== 'undefined') {
  setInterval(async () => {
    if (authStore.shouldRefreshToken() && authStore.getToken()) {
      await authStore.refreshToken();
    }
  }, 60000); // Check every minute
}

function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([dhms])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // Default 7 days

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * (multipliers[unit] || 1);
}

