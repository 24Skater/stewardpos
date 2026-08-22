// Use relative path for API calls to leverage Vite proxy
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export interface ApiError {
  message: string;
  status: number;
  errors?: Record<string, string[]>;
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public message: string,
    public errors?: Record<string, string[]>,
    /**
     * The full response envelope.
     *
     * Some endpoints attach domain fields to a failure that the caller needs in order
     * to choose what to show - `hasRelatedRecords` on a blocked customer delete, for
     * one. Those used to be read off a returned envelope; now that failures throw,
     * they travel here.
     */
    public body?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

import { authStore } from './auth-store';
import { clearDeviceToken, getDeviceToken, getSelectedRegisterId } from './register-device';

async function getToken(): Promise<string | null> {
  return authStore.getToken();
}

/**
 * The common request headers: auth, and the caller's register attribution.
 *
 * `X-Register-Id` is deliberately omitted rather than sent empty when no
 * register is selected - the backend's own fallback (the org's
 * lowest-numbered active register, see `registerContext.ts`) handles that
 * case, and an empty header value would be rejected as if it named a
 * register that doesn't exist.
 *
 * `X-Register-Token` is sent whenever a device has paired (see
 * `register-device.ts`), *alongside* `X-Register-Id` when both are present -
 * the backend prefers the verified token over the unverified id
 * (`registerContext.ts`), so sending both costs nothing and keeps a terminal
 * working through the moment it enrols without a code change here.
 */
function requestHeaders(
  token: string | null,
  extra?: Record<string, string>
): Record<string, string> {
  const registerId = getSelectedRegisterId();
  const registerToken = getDeviceToken();

  return {
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(registerId && { 'X-Register-Id': registerId }),
    ...(registerToken && { 'X-Register-Token': registerToken }),
    ...extra,
  };
}

/** The envelope every backend route responds with. */
interface ApiEnvelope<T, M extends ResponseMeta = ResponseMeta> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  errors?: Record<string, string[]>;
  /**
   * A stable discriminator on failures that share a status code, set by the
   * backend's `AppError#code`. Present only where a client genuinely has to
   * branch — branch on this, never on `error`, which is prose and will be
   * reworded.
   */
  code?: string;
  meta?: M;
  /** Some routes name this `pagination` instead of `meta`; both are accepted. */
  pagination?: M;
}

/**
 * Pagination metadata on list endpoints that provide it.
 *
 * Fields beyond `total` are optional because routes differ: /api/receipts paginates
 * by offset and states `hasMore` itself, while others are page-based. Standardising
 * the backend on one shape is a later cleanup.
 */
export interface ResponseMeta {
  total: number;
  limit?: number;
  offset?: number;
  page?: number;
  hasMore?: boolean;
}

/**
 * Unwrap the backend envelope, or throw.
 *
 * Callers receive the payload, never `{success, data}`. A transport error, an HTTP
 * error status, or `success: false` all raise ApiClientError, so a returned value
 * always means the call succeeded and no caller has to re-check `success`.
 */
async function handleResponse<T>(response: Response, path: string): Promise<T> {
  const body: ApiEnvelope<T> = await response.json().catch(() => ({ success: false }));

  if (!response.ok || body.success === false) {
    const message = body.error || body.message || 'An error occurred';
    if (response.status === 401) {
      handleUnauthorized(body, path);
    }
    throw new ApiClientError(response.status, message, body.errors, body as unknown as Record<string, unknown>);
  }

  return body.data as T;
}

/**
 * Read the envelope's `meta` alongside the payload, for paginated endpoints.
 * Most callers want {@link handleResponse}.
 */
async function handleResponseWithMeta<T, M extends ResponseMeta = ResponseMeta>(
  response: Response,
  path: string
): Promise<{ data: T; meta?: M }> {
  const body: ApiEnvelope<T, M> = await response.json().catch(() => ({ success: false }));

  if (!response.ok || body.success === false) {
    const message = body.error || body.message || 'An error occurred';
    if (response.status === 401) {
      handleUnauthorized(body, path);
    }
    throw new ApiClientError(response.status, message, body.errors, body as unknown as Record<string, unknown>);
  }

  return { data: body.data as T, meta: body.meta ?? body.pagination };
}

/**
 * Whether a 401's message identifies a bad `X-Register-Token` specifically,
 * as opposed to an ordinary expired user session.
 *
 * The backend has no structured error code for this - `registerContext.ts`
 * and `registerAuth.ts` both raise a plain `AuthenticationError`, which the
 * error handler serialises as `{ success: false, error: <message> }` same as
 * every other 401 - so the message text is the only signal available. Every
 * register-token failure path on the backend names the header explicitly
 * ("X-Register-Token is required" / "...is invalid or has been revoked" /
 * "...does not belong to your organization"), while user-session failures
 * never do ("Not authenticated", "Session expired"), so matching on that
 * substring is reliable today. If the backend ever adds a machine-readable
 * discriminator (an error `code`, say), prefer that over this.
 */
/**
 * Stamped by the backend on a 401 caused by the *device* credential rather than
 * the user's session. Must match `REGISTER_TOKEN_INVALID` in
 * `backend/src/api/middleware/registerErrorCodes.ts` — it is part of the API
 * contract, not a message.
 */
const REGISTER_TOKEN_INVALID = 'REGISTER_TOKEN_INVALID';

/**
 * Stamped on a 401 where the *shift* behind a till session is over — the
 * cashier signed out, went idle, was superseded, or an admin revoked the
 * register. Must match `SHIFT_ENDED` in
 * `backend/src/api/middleware/registerErrorCodes.ts`.
 */
const SHIFT_ENDED = 'SHIFT_ENDED';

/**
 * Stamped on a 401 where the shift is gone *and so is the register* — retired,
 * disabled, or never activated. Must match `REGISTER_INACTIVE` in
 * `backend/src/api/middleware/registerErrorCodes.ts`. Distinct from
 * {@link SHIFT_ENDED} precisely because the recoveries differ: no PIN reopens
 * a till that no longer exists.
 */
const REGISTER_INACTIVE = 'REGISTER_INACTIVE';

/**
 * The till's own front door. `/` and `/pos` both render `RequireTill`, which
 * picks between the PIN pad and `/pair` on its own once the dead token is
 * gone — so a 401 raised from either one needs no navigation at all, and a
 * hard one would throw the running app away to rebuild the page it is on.
 */
const TILL_ENTRY_PATHS = new Set(['/', '/pos']);

/**
 * Whether a 401 means "this terminal was revoked" rather than "sign in again".
 *
 * Reads the envelope's machine-readable `code`. It deliberately does **not**
 * fall back to matching the prose: a silent regex fallback would hide the day
 * the backend stops sending the code, and the symptom — a revoked till quietly
 * retrying forever instead of showing the pairing screen — is exactly what
 * enrolment exists to prevent. Better it fail as an ordinary session 401, which
 * is visible, than appear to work.
 */
function isRegisterTokenFailure(envelope: { code?: string } | undefined): boolean {
  return envelope?.code === REGISTER_TOKEN_INVALID;
}

/**
 * Drop the session and send the user to sign in again.
 *
 * Centralised here so an expired token cannot leave pages retrying with a dead
 * credential. Uses a hard location change rather than the router because this runs
 * outside React and must work from any call site.
 */
function onUnauthorized(): void {
  authStore.clearToken();

  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.assign('/login');
  }
}

/**
 * Drop the device credential and send the terminal back to pair.
 *
 * A revoked or otherwise invalid `X-Register-Token` means this specific
 * physical till can no longer authenticate as itself - that is the entire
 * point of Phase 3's enrolment (see `register-device.ts`). The failure mode
 * this guards against is a revoked terminal that keeps silently sending the
 * dead token forever, never telling the person standing at it that the
 * register needs to be re-paired.
 */
function onRegisterTokenRevoked(): void {
  clearDeviceToken();

  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/pair')) {
    window.location.assign('/pair');
  }
}

/**
 * Drop the dead till session and return the terminal to its own front door.
 *
 * A shift ends for ordinary reasons all day long — the cashier signs out, goes
 * idle, or another one takes the register — and the person standing there is a
 * cashier, who has no back-office password. Routing this through
 * {@link onUnauthorized} put them at `/login` with nothing to type, which is
 * the exact door PIN auth exists to keep them away from. `RequireTill` decides
 * between the PIN pad and `/pair` once the token is gone, so this only has to
 * get them back to a route that renders it.
 */
function onShiftEnded(): void {
  authStore.clearToken();

  if (typeof window !== 'undefined' && !TILL_ENTRY_PATHS.has(window.location.pathname)) {
    window.location.assign('/pos');
  }
}

/**
 * Drop both credentials and send a decommissioned terminal back to pair.
 *
 * `REGISTER_INACTIVE` says the register itself is no longer active, so unlike
 * {@link onShiftEnded} there is no pad to return to: the device credential
 * names a till that cannot open a shift again until someone re-pairs this
 * browser against a live one. The session token goes too — it was bound to
 * that same dead register.
 */
function onRegisterDecommissioned(): void {
  authStore.clearToken();
  onRegisterTokenRevoked();
}

/**
 * Endpoints where a 401 means "that credential was wrong", not "your session
 * expired".
 *
 * These are the two doors themselves. A rejected PIN or password has no session
 * to drop and nowhere to send anyone — the caller renders the failure and lets
 * them try again. Treating it as an expired session replaced the till's lock
 * screen with the back-office login page mid-keystroke, which is the exact door
 * this app's till auth exists to keep cashiers away from.
 *
 * `/api/auth/till/assume` is deliberately NOT here: it is called with an
 * existing back-office session, so a 401 there really does mean that session is
 * gone.
 */
const SIGN_ON_PATHS = new Set(['/api/auth/login', '/api/auth/till']);

/** Route a 401 to the right recovery path - see {@link isRegisterTokenFailure}. */
function handleUnauthorized(envelope: { code?: string } | undefined, path: string): void {
  if (isRegisterTokenFailure(envelope)) {
    // Ahead of the sign-on check: a terminal whose device credential is dead
    // cannot be rescued by a better PIN, whichever endpoint said so.
    onRegisterTokenRevoked();
    return;
  }

  if (envelope?.code === REGISTER_INACTIVE) {
    // Also ahead of the sign-on check, and ahead of SHIFT_ENDED: a PIN typed
    // at a retired till is answered by re-pairing, not by trying again.
    onRegisterDecommissioned();
    return;
  }

  if (envelope?.code === SHIFT_ENDED) {
    onShiftEnded();
    return;
  }

  if (SIGN_ON_PATHS.has(path)) return;

  onUnauthorized();
}

export const apiClient = {
  async get<T>(path: string): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: requestHeaders(token, { 'Content-Type': 'application/json' }),
    });
    return handleResponse<T>(response, path);
  },

  /**
   * `options.headers` layers on top of the common set — used for the one-off
   * headers a single call needs that every request should not carry, e.g.
   * `X-Override-Token` on the handful of endpoints a manager override can
   * unlock (`registerContext.ts`'s `readOverrideToken`). Omit it and this
   * behaves exactly as before.
   */
  async post<T>(path: string, data?: unknown, options?: { headers?: Record<string, string> }): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: requestHeaders(token, { 'Content-Type': 'application/json', ...options?.headers }),
      body: JSON.stringify(data),
    });
    return handleResponse<T>(response, path);
  },

  async put<T>(path: string, data?: unknown): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'PUT',
      headers: requestHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    return handleResponse<T>(response, path);
  },

  /**
   * PATCH — used by the handful of routes (registers, locations) that model
   * updates as a partial patch rather than the full-resource PUT most of this
   * app's admin routes expect. Mirrors `put` otherwise.
   */
  async patch<T>(path: string, data?: unknown): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'PATCH',
      headers: requestHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    return handleResponse<T>(response, path);
  },

  async delete<T>(path: string): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'DELETE',
      headers: requestHeaders(token, { 'Content-Type': 'application/json' }),
    });
    return handleResponse<T>(response, path);
  },

  /**
   * POST multipart form data (file uploads).
   *
   * Deliberately does not set `Content-Type`: the browser must generate it so it
   * can append the multipart boundary. Setting it by hand produces a body the
   * server cannot parse.
   */
  async postForm<T>(path: string, form: FormData): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: requestHeaders(token),
      body: form,
    });
    return handleResponse<T>(response, path);
  },

  /**
   * GET a list endpoint, keeping the envelope's `meta`.
   *
   * `M` widens `meta` for endpoints that report more than paging — categories
   * carry the unmanaged names there — while defaulting to the common shape.
   */
  async getList<T, M extends ResponseMeta = ResponseMeta>(
    path: string
  ): Promise<{ data: T; meta?: M }> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: requestHeaders(token, { 'Content-Type': 'application/json' }),
    });
    return handleResponseWithMeta<T, M>(response, path);
  },
};

