import { apiClient } from '../api-client';
import { qs } from './qs';
import type { DrawerSession } from './drawer';

/** Mirrors `registers.type` — see migration 015. */
export type RegisterType = 'fixed' | 'mobile' | 'web' | 'kiosk';

/** Mirrors `registers.status` — see migration 015 and `services/registers.ts`. */
export type RegisterStatus = 'pending' | 'active' | 'disabled' | 'retired';

/**
 * Derived from `last_seen_at`, not stored — see `deriveRegisterLiveness` in
 * `backend/src/services/registers.ts`. `never` (no heartbeat has ever
 * landed) is distinct from `offline` (one landed, then stopped).
 */
export type RegisterLiveness = 'online' | 'idle' | 'offline' | 'never';

/** Mirrors `locations.status` — see migration 015. */
export type LocationStatus = 'active' | 'retired';

/**
 * A till: belongs to a location, numbered within it, carrying the
 * capabilities that decide what a cashier can do there.
 *
 * `registerNumber` and `displayCode` are server-generated — see
 * `services/registers.ts` — and are never sent on create or update.
 */
export interface Register {
  id: string;
  orgId: string;
  locationId: string;
  name: string;
  registerNumber: number;
  displayCode: string;
  placement: string | null;
  type: RegisterType;
  hasCashDrawer: boolean;
  acceptsCash: boolean;
  canRefund: boolean;
  canOpenDrawerNoSale: boolean;
  requireSignIn: boolean;
  idleLockSeconds: number;
  terminalProvider: string | null;
  terminalDeviceId: string | null;
  status: RegisterStatus;
  /** Epoch ms. Null until an enrolled device's first heartbeat lands. */
  lastSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Present on list and single-register reads; saves a second lookup to name the till's site. */
  locationName?: string;
  /**
   * Derived from `lastSeenAt` by the backend, not stored. Present wherever
   * the backend attaches it (list, single-register read, pair, revoke) —
   * absent on the plain rows `create`/`update`/`disable`/`activate`/`retire`
   * return, since those don't route through `withLiveness`.
   */
  liveness?: RegisterLiveness;
}

/**
 * A physical site — an address, a timezone — that registers belong to.
 */
export interface Location {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  timezone: string;
  status: LocationStatus;
  createdAt: number;
  updatedAt: number;
  /** Present on list reads only: how many non-retired registers this location has. */
  registerCount?: number;
}

export interface RegisterListQuery {
  locationId?: string;
  status?: RegisterStatus;
}

export interface CreateRegisterRequest {
  locationId: string;
  name: string;
  placement?: string | null;
  type?: RegisterType;
  hasCashDrawer?: boolean;
  acceptsCash?: boolean;
  canRefund?: boolean;
  canOpenDrawerNoSale?: boolean;
  requireSignIn?: boolean;
  idleLockSeconds?: number;
  terminalProvider?: string | null;
  terminalDeviceId?: string | null;
  /**
   * Override for the server-derived `<LOCATION-SLUG>-<NN>` code. Omit this —
   * the whole point of the auto-numbering is that nobody has to invent one.
   */
  displayCode?: string;
}

/** Everything but the location a register is created at, which never moves once set. */
export type UpdateRegisterRequest = Partial<Omit<CreateRegisterRequest, 'locationId'>>;

export interface CreateLocationRequest {
  name: string;
  /** Auto-derived from `name` when omitted — see `slugify` in `services/registers.ts`. */
  slug?: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  timezone?: string;
  status?: LocationStatus;
}

export type UpdateLocationRequest = Partial<CreateLocationRequest>;

/**
 * A freshly issued pairing code (`POST /:id/pairing-code`).
 *
 * Shown to the operator exactly once — the backend keeps only a hash of it —
 * so there is no `get` to re-fetch it. `formattedCode` is `code` grouped as
 * `XXXX-XXXX` for reading off one screen and typing into another;
 * `code` is the same value ungrouped.
 */
export interface RegisterPairingCode {
  code: string;
  formattedCode: string;
  /** Epoch ms. 15 minutes from issuance — see `PAIRING_CODE_TTL_MS` in `registerEnrolment.ts`. */
  expiresAt: number;
  registerId: string;
}

/**
 * The result of redeeming a pairing code (`POST /pair`).
 *
 * `token` is the device credential itself, returned exactly once — see the
 * handling rules on `setDeviceToken` in `lib/register-device.ts`.
 */
export interface PairDeviceResult {
  token: string;
  register: Register;
}

export interface RevokeRegisterRequest {
  reason?: string;
  /**
   * Required to revoke a register with an open cash drawer session — see
   * `RevokeRegisterResult.closedDrawerSession`. Omitting it when a drawer is
   * open gets a 409 back instead of revoking.
   */
  force?: boolean;
}

export interface RevokeRegisterResult {
  register: Register;
  /**
   * Set only when `force: true` closed an open drawer session as part of the
   * revoke — closed at its own expected cash, never counted, and meant to be
   * flagged for review rather than trusted as a real reconciliation.
   */
  closedDrawerSession: DrawerSession | null;
}

/** Mirrors `services/registerShifts.ts`'s `EndShiftReason`. */
export type ShiftEndReason = 'signed_out' | 'idle_timeout' | 'superseded' | 'revoked' | 'forced';

/**
 * Which employee is standing at a register right now — see migration 018
 * and `backend/src/services/registerShifts.ts`.
 *
 * Deliberately not a session: it says who is currently ringing sales at an
 * already-authenticated till, nothing more. `endedAt`/`endReason` are both
 * null while the shift is open.
 */
export interface Shift {
  id: string;
  registerId: string;
  userId: string;
  /** Epoch ms. */
  startedAt: number;
  /** Epoch ms. Bumped by the server on every authenticated action; drives idle expiry. */
  lastActivityAt: number;
  /** Epoch ms, or null while the shift is open. */
  endedAt: number | null;
  endReason: ShiftEndReason | null;
  createdAt: number;
}

export interface ShiftCashier {
  id: string;
  name: string;
}

export interface StartShiftResult {
  shift: Shift;
  cashier: ShiftCashier;
}

export interface CurrentShiftResult {
  shift: Shift;
  /** Present whenever `shift` is — `getUserById` returning null would mean a shift outlived its user, which does not happen in practice. */
  cashier: ShiftCashier | null;
}

/**
 * Manager overrides (`backend/src/services/registerOverrides.ts`, migration
 * 019): a supervisor authorising exactly one privileged action at a till
 * without touching the cashier's shift. Mirrors the backend's action
 * vocabulary exactly — see `OverrideAction` there.
 */
export type OverrideAction = 'discount_approval' | 'drawer_variance' | 'void' | 'no_sale';

export interface RequestOverrideRequest {
  action: OverrideAction;
  /** The supervisor's PIN. Never logged, never rendered — see `OverridePrompt.tsx`. */
  pin: string;
  reason?: string;
}

/**
 * A freshly minted override grant (`POST /:id/overrides`).
 *
 * `token` travels as `X-Override-Token` on the retried request — see
 * `readOverrideToken` in `backend/src/api/middleware/registerContext.ts`.
 * Shown/usable exactly once: the backend only ever stores a hash of it, and
 * it is consumed (or expires in 90 seconds) the moment it is spent.
 */
export interface RequestOverrideResult {
  token: string;
  /** Epoch ms — ninety seconds from issuance. Short on purpose; see `OverridePrompt.tsx`. */
  expiresAt: number;
  action: OverrideAction;
}

/**
 * One row of the override log (`GET /api/registers/overrides`) — the safe
 * projection the backend returns, never the grant hash. Serves as both "what
 * was authorised" and "what it was used for": `consumedAt`/`entity`/
 * `entityId`/`beforeValue`/`afterValue` are all null until the grant is
 * actually spent, and stay null forever on a grant a supervisor declined or
 * that simply expired unused — that is a signal worth seeing, not a gap in
 * the data.
 */
export interface RegisterOverride {
  id: string;
  registerId: string;
  shiftId: string | null;
  approverUserId: string;
  requestedByUserId: string | null;
  action: OverrideAction;
  grantPrefix: string;
  expiresAt: number;
  consumedAt: number | null;
  entity: string | null;
  entityId: string | null;
  beforeValue: string | null;
  afterValue: string | null;
  reason: string | null;
  createdAt: number;
}

export interface RegisterOverrideQuery {
  limit?: number;
  offset?: number;
  registerId?: string;
  approverUserId?: string;
}

/**
 * Register endpoints (`backend/src/api/routes/registers.ts`).
 *
 * Registers are never deleted, only retired — permanently, since a retired
 * register's number and display code are never reused (migration 015) — so
 * there is deliberately no `remove`. `update` is a PATCH, unlike most of this
 * SDK's PUT-based updates: registers and locations are the only routes
 * modelled as a partial patch rather than a full-resource replace.
 *
 * `pairingCode`, `pair`, `heartbeat` and `revoke` are Phase 3's device
 * enrolment additions — see `backend/src/services/registerEnrolment.ts`.
 * `pair` and `heartbeat` authenticate as a device rather than a user
 * (`X-Register-Token`, attached automatically by `api-client.ts` once one is
 * stored — see `lib/register-device.ts`), which is why `pair` works with no
 * session at all.
 */
export const registersApi = {
  list: (filter?: RegisterListQuery) => apiClient.get<Register[]>(`/api/registers${qs(filter)}`),
  get: (id: string) => apiClient.get<Register>(`/api/registers/${id}`),
  create: (body: CreateRegisterRequest) => apiClient.post<Register>('/api/registers', body),
  update: (id: string, body: UpdateRegisterRequest) =>
    apiClient.patch<Register>(`/api/registers/${id}`, body),
  /** Permanent — see the note on this module. Confirm with the user before calling. */
  retire: (id: string) => apiClient.post<Register>(`/api/registers/${id}/retire`),
  /** Temporary: still counts against the org's register cap while disabled. */
  disable: (id: string) => apiClient.post<Register>(`/api/registers/${id}/disable`),
  /** Brings a pending or disabled register back into service. */
  activate: (id: string) => apiClient.post<Register>(`/api/registers/${id}/activate`),
  /** Mint a fresh pairing code, invalidating any prior live credential. Admin action; needs a session. */
  pairingCode: (id: string) => apiClient.post<RegisterPairingCode>(`/api/registers/${id}/pairing-code`),
  /** Redeem a pairing code for a device token. No session required — see the note on this module. */
  pair: (code: string) => apiClient.post<PairDeviceResult>('/api/registers/pair', { code }),
  /** Called by an enrolled device roughly once a minute, not by an admin. */
  heartbeat: (id: string) => apiClient.post<Register>(`/api/registers/${id}/heartbeat`),
  /** Destroy a register's live credential and return it to `pending`. See `RevokeRegisterRequest.force`. */
  revoke: (id: string, body?: RevokeRegisterRequest) =>
    apiClient.post<RevokeRegisterResult>(`/api/registers/${id}/revoke`, body ?? {}),

  /**
   * Sign a cashier on to this register with a PIN (`POST /:id/shifts`).
   *
   * Authenticates as the device (`X-Register-Token`, attached automatically by
   * `api-client.ts` — see `lib/register-device.ts`), not a user session, so this
   * works from the lock screen with nobody signed in. A failure carries a stable
   * `code` on the thrown `ApiClientError`'s `body` — `PIN_INVALID` or
   * `PIN_LOCKED` (`backend/src/api/middleware/registerErrorCodes.ts`) — branch on
   * that, never on the message text.
   */
  startShift: (id: string, pin: string) =>
    apiClient.post<StartShiftResult>(`/api/registers/${id}/shifts`, { pin }),
  /** Sign out whoever is currently on this register. 404s (as `ApiClientError`) if nothing is open. */
  endShift: (id: string) => apiClient.post<{ shift: Shift }>(`/api/registers/${id}/shifts/end`),
  /** Who is on this register right now, or `null`. Used to decide whether to show the lock screen. */
  currentShift: (id: string) =>
    apiClient.get<CurrentShiftResult | null>(`/api/registers/${id}/shifts/current`),

  /**
   * Request a manager-override grant for one action on this till
   * (`POST /:id/overrides`). Authenticates as the device
   * (`X-Register-Token`), same as `startShift` — this runs from the till,
   * not a manager's own session. A failure carries a stable `code` on the
   * thrown `ApiClientError`'s `body` — `PIN_INVALID` or `PIN_LOCKED`
   * (`backend/src/api/middleware/registerErrorCodes.ts`) — branch on that,
   * never on the message text. See `OverridePrompt.tsx`.
   */
  requestOverride: (id: string, body: RequestOverrideRequest) =>
    apiClient.post<RequestOverrideResult>(`/api/registers/${id}/overrides`, body),

  /**
   * The override log (`GET /api/registers/overrides`) — every grant ever
   * issued in the org, spent or not, newest first. Paginated the same way
   * `adminApi.audit` is. See `AdminOverrides.tsx`.
   */
  overrides: (query?: RegisterOverrideQuery) =>
    apiClient.getList<RegisterOverride[]>(`/api/registers/overrides${qs(query)}`),
};

/**
 * Location endpoints (`backend/src/api/routes/locations.ts`).
 *
 * Sit under the `registers` permission rather than one of their own — see
 * that route file — so this module has no separate delete either.
 */
export const locationsApi = {
  list: () => apiClient.get<Location[]>('/api/locations'),
  get: (id: string) => apiClient.get<Location>(`/api/locations/${id}`),
  create: (body: CreateLocationRequest) => apiClient.post<Location>('/api/locations', body),
  update: (id: string, body: UpdateLocationRequest) =>
    apiClient.patch<Location>(`/api/locations/${id}`, body),
};
