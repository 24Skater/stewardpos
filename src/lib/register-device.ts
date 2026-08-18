/**
 * Which register this browser/terminal is acting as, and — since Phase 3 —
 * the device credential that proves it.
 *
 * The backend resolves every money-moving request via `X-Register-Token`
 * when one is presented, falling back to the unverified `X-Register-Id`
 * claim, and finally to the org's lowest-numbered active register (see
 * `backend/src/api/middleware/registerContext.ts`). This module is the
 * frontend half: it remembers which register a terminal was last set to and
 * the token it earned by pairing, both persisted in `localStorage` so they
 * survive a reload, and exposes them for `api-client.ts` to attach to
 * outgoing requests.
 *
 * `localStorage` can throw on access — Safari private browsing being the
 * usual case — so every access is guarded. When it is unavailable, the
 * selection still works for the current page load; it just does not survive
 * a reload, which is a strictly better failure mode than crashing the app.
 *
 * An enrolled terminal's `X-Register-Id` selection and its device token
 * name the same register — `PairRegister.tsx` sets both on success — so the
 * legacy picker (`RegisterSwitcher.tsx`) keeps working unchanged for a
 * terminal that has not yet enrolled a device.
 */

const STORAGE_KEY = 'steward-terminal-register-id';
const TOKEN_STORAGE_KEY = 'steward-terminal-register-token';

type Listener = (registerId: string | null) => void;

/** Used only when `localStorage` is unreachable. Lost on reload, same as any other in-memory value. */
let memoryValue: string | null = null;
/** Used only when `localStorage` is unreachable — same fallback as `memoryValue` above. */
let memoryToken: string | null = null;
let storageAvailable: boolean | null = null;
const listeners = new Set<Listener>();

function isStorageAvailable(): boolean {
  if (storageAvailable !== null) return storageAvailable;

  if (typeof window === 'undefined') {
    storageAvailable = false;
    return storageAvailable;
  }

  try {
    const probe = '__steward_register_device_probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    storageAvailable = true;
  } catch {
    // Safari private mode (and some locked-down environments) throw on any
    // localStorage access, not just when full. Either way, degrade quietly.
    storageAvailable = false;
  }

  return storageAvailable;
}

/** The register this terminal is currently set to, or `null` if none is selected. */
export function getSelectedRegisterId(): string | null {
  if (isStorageAvailable()) {
    return window.localStorage.getItem(STORAGE_KEY);
  }
  return memoryValue;
}

/** Select a register for this terminal. Persisted across reloads when `localStorage` works. */
export function setSelectedRegisterId(registerId: string): void {
  if (isStorageAvailable()) {
    window.localStorage.setItem(STORAGE_KEY, registerId);
  } else {
    memoryValue = registerId;
  }
  notify(registerId);
}

/**
 * Clear the selection, e.g. because the stored register was retired or
 * disabled on another terminal and no longer resolves. Requests fall back to
 * the backend's own default (the org's lowest-numbered active register)
 * rather than sending a header the server will reject.
 */
export function clearSelectedRegisterId(): void {
  if (isStorageAvailable()) {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    memoryValue = null;
  }
  notify(null);
}

function notify(registerId: string | null): void {
  for (const listener of listeners) {
    listener(registerId);
  }
}

/**
 * Subscribe to selection changes made through this module (in this tab).
 * Returns an unsubscribe function.
 *
 * Does not observe the native `storage` event — that only fires in *other*
 * tabs — nor an edit made directly against `localStorage` outside this
 * module. A component that needs to react to a switch (the register picker
 * itself) should call this rather than polling.
 */
export function subscribeToSelectedRegisterId(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The device credential minted when this terminal pairs (`POST
 * /api/registers/pair` — see `PairRegister.tsx` and
 * `backend/src/services/registerEnrolment.ts`).
 *
 * Unlike the register id above, this is a bearer credential: anyone holding
 * it can act as this specific till against every money-moving endpoint.
 * Treat it accordingly —
 *
 * - Never log it, in this module or any caller.
 * - Never put it in a URL or query string; it belongs in the
 *   `X-Register-Token` header only (see `api-client.ts`), never anywhere a
 *   proxy access log or browser history would capture it.
 * - Never render it back to the screen. The backend returns it exactly once,
 *   at pairing — `PairRegister.tsx` shows it nowhere and keeps it in local
 *   state only long enough to hand it to `setDeviceToken`.
 */
export function getDeviceToken(): string | null {
  if (isStorageAvailable()) {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  }
  return memoryToken;
}

/** Store the device token minted at pairing. Persisted across reloads when `localStorage` works. */
export function setDeviceToken(token: string): void {
  if (isStorageAvailable()) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    memoryToken = token;
  }
}

/**
 * Clear the device token — e.g. because an admin revoked this register's
 * credential and the next request came back 401 for it (see the dedicated
 * 401 handling in `api-client.ts`, which calls this before routing to
 * `/pair`). The terminal falls back to whatever `X-Register-Id` alone would
 * resolve to until it is paired again.
 */
export function clearDeviceToken(): void {
  if (isStorageAvailable()) {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } else {
    memoryToken = null;
  }
}
