import { apiClient } from '../api-client';
import { qs } from './qs';
import type {
  AuditLog,
  Role,
  RolePermissions,
  Settings,
  UpdateSettingsRequest,
  User,
} from './types';

export interface CreateUserRequest {
  name: string;
  email: string;
  password: string;
  roleIds: string[];
  status?: 'active' | 'inactive';
}

export type UpdateUserRequest = Partial<CreateUserRequest>;

/** Body of `PUT /api/admin/users/:id/pin`. */
export interface SetPinRequest {
  pin: string;
}

/**
 * What `PUT`/`DELETE /api/admin/users/:id/pin` return.
 *
 * Deliberately narrow: those routes answer only whether a PIN is now set, and
 * the PIN itself is never echoed back. An earlier version of this type claimed
 * `email`, `name`, `status` and `pinSetAt`, none of which those routes send —
 * nothing caught it because no caller read them.
 */
export interface UserPinState {
  id: string;
  pinSet: boolean;
}

/**
 * What `POST /api/admin/users/:id/pin/unlock` returns.
 *
 * A different shape from {@link UserPinState} because it answers a different
 * question — the lockout counters, not whether a PIN exists. `pinLockedUntil`
 * and `pinFailedCount` are always cleared values on a successful unlock; they
 * are returned so a caller can render the new state without a refetch.
 */
export interface UserPinLockState {
  id: string;
  /** Epoch ms, or null if the employee has no PIN. */
  pinSetAt: number | null;
  /** Epoch ms, or null once unlocked. */
  pinLockedUntil: number | null;
  pinFailedCount: number;
}

export interface RoleInput {
  name: string;
  /** Marks the role as one of the built-in archetypes; omit for custom roles. */
  systemRole?: 'admin' | 'supervisor' | 'reporter' | 'standard';
  permissions: RolePermissions;
}

export interface AuditQuery {
  limit?: number;
  offset?: number;
  userId?: string;
  entity?: string;
  action?: string;
  /** Epoch milliseconds; both ends inclusive, as the reporting endpoints read them. */
  from?: number;
  to?: number;
}

/**
 * Admin endpoints (`backend/src/api/routes/admin.ts`).
 *
 * Everything here sits behind an authenticated admin session; a 401 unwinds to
 * the login redirect inside `api-client`.
 */
export const adminApi = {
  users: {
    list: () => apiClient.get<User[]>('/api/admin/users'),
    create: (body: CreateUserRequest) => apiClient.post<User>('/api/admin/users', body),
    update: (id: string, body: UpdateUserRequest) =>
      apiClient.put<User>(`/api/admin/users/${id}`, body),
    remove: (id: string) => apiClient.delete<void>(`/api/admin/users/${id}`),
    /** Set (or replace) an employee's register PIN (`backend/src/api/routes/admin.ts:162`). */
    setPin: (id: string, body: SetPinRequest) =>
      apiClient.put<UserPinState>(`/api/admin/users/${id}/pin`, body),
    /** Clear an employee's PIN, revoking their register sign-on access. Leaves any open shift running. */
    clearPin: (id: string) => apiClient.delete<UserPinState>(`/api/admin/users/${id}/pin`),
    /**
     * Clear a PIN lockout without waiting out the fifteen minutes.
     *
     * Does not change the PIN — the cashier's existing one works again the
     * moment this returns.
     */
    unlockPin: (id: string) =>
      apiClient.post<UserPinLockState>(`/api/admin/users/${id}/pin/unlock`, {}),
  },

  roles: {
    list: () => apiClient.get<Role[]>('/api/admin/roles'),
    create: (body: RoleInput) => apiClient.post<Role>('/api/admin/roles', body),
    update: (id: string, body: Partial<RoleInput>) =>
      apiClient.put<Role>(`/api/admin/roles/${id}`, body),
    remove: (id: string) => apiClient.delete<void>(`/api/admin/roles/${id}`),
  },

  settings: {
    get: () => apiClient.get<Settings>('/api/admin/settings'),
    update: (body: UpdateSettingsRequest) => apiClient.put<Settings>('/api/admin/settings', body),
  },

  /**
   * Audit log, filtered and paged by the server.
   *
   * Returns the envelope's `meta` alongside the page: the total is what lets a
   * caller page at all, and its absence is why this screen used to pull the
   * newest hundred entries and filter them in the browser.
   */
  audit: (query?: AuditQuery) => apiClient.getList<AuditLog[]>(`/api/admin/audit${qs(query)}`),

  /**
   * Wipe and reseed. **Development only** — the server refuses in production.
   *
   * This is not "reload sample products": it truncates orders and order items,
   * deletes every staff account, and reseeds the demo admin. The confirmation
   * string is required by the server so a misclick cannot trigger it.
   */
  resetDatabase: () => apiClient.post<void>('/api/admin/reset-database', { confirm: 'RESET' }),
};
