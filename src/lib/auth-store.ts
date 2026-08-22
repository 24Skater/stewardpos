import { authApi } from './api/auth';

interface AuthToken {
  token: string;
  expiresAt: number;
}

const TOKEN_KEY = 'auth_token';
/** Details of an assumed till session — see {@link readAssumedSession}. */
const ASSUMED_KEY = 'assumed_session';
const TOKEN_EXPIRY_KEY = 'auth_token_expiry';
const REFRESH_THRESHOLD = 5 * 60 * 1000; // 5 minutes before expiry

/** Matches the backend's own default when JWT_EXPIRES_IN is unset. */
const DEFAULT_EXPIRES_IN = '24h';

export const authStore = {
  /**
   * Store a token and when it lapses.
   *
   * `expiresIn` should come from the server's response. The default is a
   * fallback for a backend that does not report one, and is deliberately short:
   * guessing too long leaves the client convinced a dead token is good and
   * never refreshing, which is worse than an early, recoverable re-login.
   */
  setToken(token: string, expiresIn: string = DEFAULT_EXPIRES_IN): void {
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
    // The banner describes *this* session. Left behind, it would tell the next
    // cashier at this till that their sales belong to an admin.
    writeAssumedSession(null);
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
      const response = await authApi.refresh();
      if (response.token) {
        this.setToken(response.token, response.expiresIn);
        return true;
      }
    } catch (error) {
      this.clearToken();
      return false;
    }
    return false;
  },
};

/** What the acting-as banner needs to describe an assumed session. */
export interface AssumedSession {
  adminName: string;
  /** The cashier being covered, when one was named. */
  actingAs: string | null;
}

/**
 * The assumed-session record, or null at an ordinary till.
 *
 * Written only by `POST /api/auth/till/assume` (see `AdminRegisters`); a
 * cashier's own PIN session writes nothing here, which is why the banner never
 * appears at a real till.
 *
 * Unparseable content reads as absent rather than throwing: anything could have
 * written this key, and a crash here would take the POS down on mount.
 */
export function readAssumedSession(): AssumedSession | null {
  const raw = localStorage.getItem(ASSUMED_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AssumedSession;
  } catch {
    return null;
  }
}

export function writeAssumedSession(value: AssumedSession | null): void {
  if (value) {
    localStorage.setItem(ASSUMED_KEY, JSON.stringify(value));
  } else {
    localStorage.removeItem(ASSUMED_KEY);
  }
}

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

