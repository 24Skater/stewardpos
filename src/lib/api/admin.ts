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

/**
 * `PUT /api/admin/users/:id/pin` and `DELETE /api/admin/users/:id/pin`.
 *
 * **Backend gap, flagged rather than silently worked around**: as of this
 * phase's backend commits, `services/pins.ts#setPin` and the `users.pin_hash`
 * column exist and are fully exercised by `POST /:id/shifts`
 * (`registerShifts.startShift` scans every active PIN holder), but no admin
 * HTTP route calls `setPin`, and there is no service function at all to clear
 * a PIN (revoke register access) — `PostgresAdapter`/`SQLiteAdapter` only
 * expose `setUserPin`, not a clearing counterpart. This SDK method calls a
 * route that does not exist yet; the paths chosen here follow this file's
 * existing `PUT/DELETE /api/admin/users/:id` convention so wiring the backend
 * up later is a small, obvious change. Until it lands, calling these 404s.
 */
export interface SetPinRequest {
  pin: string;
}

/** The safe projection `setUserPin` already returns server-side — no `pinHash`, ever. */
export interface UserPinStatus {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'inactive';
  pinSetAt: number | null;
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
    /** Set (or replace) an employee's register PIN. See `SetPinRequest`'s doc comment — not yet wired up server-side. */
    setPin: (id: string, body: SetPinRequest) =>
      apiClient.put<UserPinStatus>(`/api/admin/users/${id}/pin`, body),
    /** Clear an employee's PIN, revoking their register sign-on access. Same caveat as `setPin`. */
    clearPin: (id: string) => apiClient.delete<UserPinStatus>(`/api/admin/users/${id}/pin`),
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
