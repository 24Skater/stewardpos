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
   * Audit log.
   *
   * Accepts `limit`/`offset` but returns no total, so a caller cannot know
   * whether more rows exist beyond asking for one more than it needs.
   */
  audit: (query?: AuditQuery) => apiClient.get<AuditLog[]>(`/api/admin/audit${qs(query)}`),

  /**
   * Wipe and reseed. **Development only** — the server refuses in production.
   *
   * This is not "reload sample products": it truncates orders and order items,
   * deletes every staff account, and reseeds the demo admin. The confirmation
   * string is required by the server so a misclick cannot trigger it.
   */
  resetDatabase: () => apiClient.post<void>('/api/admin/reset-database', { confirm: 'RESET' }),
};
