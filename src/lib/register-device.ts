/**
 * Which register this browser/terminal is acting as.
 *
 * The backend resolves every money-moving request via `X-Register-Id` (see
 * `backend/src/api/middleware/registerContext.ts`), falling back to the org's
 * lowest-numbered active register when the header is absent. This module is
 * the frontend half: it remembers which register a terminal was last set to,
 * persisted in `localStorage` so the choice survives a reload, and exposes it
 * for `api-client.ts` to attach to outgoing requests.
 *
 * `localStorage` can throw on access — Safari private browsing being the
 * usual case — so every access is guarded. When it is unavailable, the
 * selection still works for the current page load; it just does not survive
 * a reload, which is a strictly better failure mode than crashing the app.
 *
 * Device enrolment (a later phase) will make this authoritative and probably
 * replace the manual picker built on top of it; until then this is a plain
 * per-browser preference, not a verified device identity.
 */

const STORAGE_KEY = 'steward-terminal-register-id';

type Listener = (registerId: string | null) => void;

/** Used only when `localStorage` is unreachable. Lost on reload, same as any other in-memory value. */
let memoryValue: string | null = null;
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
