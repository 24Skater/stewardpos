import { apiClient } from '../api-client';
import { qs } from './qs';

/** Mirrors `registers.type` — see migration 015. */
export type RegisterType = 'fixed' | 'mobile' | 'web' | 'kiosk';

/** Mirrors `registers.status` — see migration 015 and `services/registers.ts`. */
export type RegisterStatus = 'pending' | 'active' | 'disabled' | 'retired';

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
  /** Epoch ms. Null until the register heartbeats — not wired up yet, so this is usually null. */
  lastSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Present on list and single-register reads; saves a second lookup to name the till's site. */
  locationName?: string;
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
 * Register endpoints (`backend/src/api/routes/registers.ts`).
 *
 * Registers are never deleted, only retired — permanently, since a retired
 * register's number and display code are never reused (migration 015) — so
 * there is deliberately no `remove`. `update` is a PATCH, unlike most of this
 * SDK's PUT-based updates: registers and locations are the only routes
 * modelled as a partial patch rather than a full-resource replace.
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
