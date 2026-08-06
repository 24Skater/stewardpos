import { apiClient } from './api-client';
import { authStore } from './auth-store';
import type { SessionResponse } from './api/types';
import type { RolePermissions } from './permissions';
import { logger } from './logger';

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
    if (response?.user) {
      const user = response.user;
      
      // Ensure user has required properties
      if (!user.id || !user.email || !user.name) {
        logger.warn('Session response missing required user fields');
        authStore.clearToken();
        currentSession = null;
        return null;
      }

      // Merge permissions from roles
      const permissions = mergePermissions(
        (user.roles || []).map((r) => r.permissions || ({} as RolePermissions))
      );

      currentSession = {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roleIds: user.roleIds || [],
          roles: user.roles || [],
        },
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

/**
 * Whether the session may take `action` on `domain`.
 *
 * Admins pass regardless, matching the server's `requirePermission`: a resource
 * key added later must not lock out the account that has to configure it. Keep
 * the two in step - this decides what the UI offers, the server decides what it
 * accepts, and a mismatch shows up as a control that always 403s.
 */
export function hasPermission(
  session: AuthSession | null,
  domain: keyof RolePermissions,
  action: 'read' | 'write' | 'delete'
): boolean {
  if (!session) return false;
  if (isAdmin(session)) return true;
  return session.permissions[domain]?.[action] === true;
}

export function isAdmin(session: AuthSession | null): boolean {
  return (session?.user?.roles || []).some((role) => role.systemRole === 'admin');
}

export function hasAnyRole(session: AuthSession | null, roleNames: string[]): boolean {
  if (!session || !session.user?.roles) return false;
  return session.user.roles.some(role => roleNames.includes(role.systemRole || role.name));
}

export function hasRole(session: AuthSession | null, roleName: string): boolean {
  return hasAnyRole(session, [roleName]);
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
      // A role's permissions JSONB need not carry every key - one written before
      // a resource existed, or edited by hand, simply omits it. Reading through
      // an absent key would throw and take down every page behind the session.
      const granted = perms?.[key];
      merged[key].read = merged[key].read || granted?.read === true;
      merged[key].write = merged[key].write || granted?.write === true;
      merged[key].delete = merged[key].delete || granted?.delete === true;
    }
  }

  return merged;
}
