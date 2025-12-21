import { apiClient } from './api-client';
import { authStore } from './auth-store';
import type { SessionResponse } from './api-types';
import type { RolePermissions } from './db';

export interface AuthSession {
  user: {
    id: string;
    email: string;
    name: string;
    roleIds: string[];
    roles: Array<{
      id: string;
      name: string;
      systemRole?: string;
      permissions: RolePermissions;
    }>;
  };
  permissions: RolePermissions;
}

let currentSession: AuthSession | null = null;

export async function getCurrentSession(): Promise<AuthSession | null> {
  // Check if token exists and is not expired
  if (!authStore.getToken() || authStore.isTokenExpired()) {
    currentSession = null;
    return null;
  }

  // If we have a cached session, return it
  if (currentSession) {
    return currentSession;
  }

  try {
    const response = await apiClient.get<SessionResponse>('/api/auth/session');
    if (response.success && response.data.user) {
      // Merge permissions from roles
      const permissions = mergePermissions(
        response.data.user.roles.map((r: any) => r.permissions || {})
      );

      currentSession = {
        user: response.data.user,
        permissions,
      };
      return currentSession;
    }
  } catch (error) {
    // Token invalid, clear it
    authStore.clearToken();
    currentSession = null;
  }

  return null;
}

export function logout(): void {
  authStore.clearToken();
  currentSession = null;
  // Optionally call backend logout endpoint
  apiClient.post('/api/auth/logout').catch(() => {
    // Ignore errors on logout
  });
}

// Legacy login function - now redirects to API-based flow
// This is kept for backward compatibility during migration
export async function login(email: string, password: string): Promise<AuthSession | null> {
  // This should now be handled by the Login page component
  // which calls the API directly
  // This function is kept for compatibility but will return null
  // The actual login is done via API in Login.tsx
  return null;
}

export function hasPermission(
  session: AuthSession | null,
  domain: keyof RolePermissions,
  action: 'read' | 'write' | 'delete'
): boolean {
  if (!session) return false;
  return session.permissions[domain][action];
}

export function hasAnyRole(session: AuthSession | null, roleNames: string[]): boolean {
  if (!session) return false;
  return session.roles.some(role => roleNames.includes(role.systemRole || role.name));
}

function mergePermissions(permissionsArray: RolePermissions[]): RolePermissions {
  const merged: RolePermissions = {
    inventory: { read: false, write: false, delete: false },
    reports: { read: false, write: false, delete: false },
    exports: { read: false, write: false, delete: false },
    settings: { read: false, write: false, delete: false },
    users: { read: false, write: false, delete: false },
    services: { read: false, write: false, delete: false },
    customers: { read: false, write: false, delete: false },
  };

  for (const perms of permissionsArray) {
    for (const domain in merged) {
      const key = domain as keyof RolePermissions;
      merged[key].read = merged[key].read || perms[key].read;
      merged[key].write = merged[key].write || perms[key].write;
      merged[key].delete = merged[key].delete || perms[key].delete;
    }
  }

  return merged;
}
