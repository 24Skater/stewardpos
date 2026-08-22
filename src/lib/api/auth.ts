import { apiClient } from '../api-client';
import type { Shift } from './registers';
import type { LoginRequest, LoginResponse, SessionResponse } from './types';

/**
 * What a till session returns.
 *
 * `user` and `shift` are null on a register with sign-in off: there is no
 * cashier to name and no shift to open, and the session is the register itself.
 */
export interface TillSession {
  token: string;
  expiresIn: string;
  register: { id: string; name?: string; displayCode?: string };
  user: { id: string; name: string; email: string } | null;
  shift: Shift | null;
}

/** What `POST /api/auth/till/assume` returns to a back-office browser. */
export interface AssumedTillSession extends Omit<TillSession, 'user'> {
  /** The cashier being covered. Recorded on the shift, never attributed to. */
  actingAs: { id: string; name: string } | null;
}

/** Auth endpoints (`backend/src/api/routes/auth.ts`, `backend/src/api/routes/till.ts`). */
export const authApi = {
  login: (body: LoginRequest) => apiClient.post<LoginResponse>('/api/auth/login', body),
  logout: () => apiClient.post<void>('/api/auth/logout'),
  session: () => apiClient.get<SessionResponse>('/api/auth/session'),
  refresh: () => apiClient.post<{ token: string; expiresIn?: string }>('/api/auth/refresh'),

  /**
   * Exchange this terminal's device token for a session.
   *
   * The register is whichever one `X-Register-Token` proves this terminal to be
   * — `api-client.ts` attaches it — so nothing here names one. Omit `pin` on a
   * register with sign-in off: the endpoint refuses a PIN it did not ask for
   * rather than ignoring it, which is why an absent PIN must not reach the wire
   * as a key at all.
   */
  till: (body: { pin?: string }) =>
    apiClient.post<TillSession>('/api/auth/till', body.pin ? { pin: body.pin } : {}),

  /** Open a register from a back-office browser. Requires `registers:write`. */
  assumeTill: (body: { registerId: string; emulateUserId?: string }) =>
    apiClient.post<AssumedTillSession>('/api/auth/till/assume', body),
};
