import { User, Role, RolePermissions } from './db';
import { getUserByEmail, verifyPassword, getAllRoles, updateUser } from './db-operations';

export interface AuthSession {
  user: User;
  roles: Role[];
  permissions: RolePermissions;
}

let currentSession: AuthSession | null = null;

export async function login(email: string, password: string): Promise<AuthSession | null> {
  const user = await getUserByEmail(email);
  
  if (!user || user.status !== 'active') {
    return null;
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  // Update last login
  await updateUser({ ...user, lastLoginAt: Date.now() });

  // Get user roles
  const allRoles = await getAllRoles();
  const userRoles = allRoles.filter(role => user.roleIds.includes(role.id));

  // Merge permissions from all roles
  const permissions = mergePermissions(userRoles.map(r => r.permissions));

  const session: AuthSession = {
    user,
    roles: userRoles,
    permissions,
  };

  currentSession = session;
  sessionStorage.setItem('auth-session', JSON.stringify(session));

  return session;
}

export function logout() {
  currentSession = null;
  sessionStorage.removeItem('auth-session');
}

export function getCurrentSession(): AuthSession | null {
  if (currentSession) return currentSession;

  const stored = sessionStorage.getItem('auth-session');
  if (stored) {
    currentSession = JSON.parse(stored);
    return currentSession;
  }

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
