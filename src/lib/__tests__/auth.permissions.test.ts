import { describe, expect, it } from 'vitest';
import { hasPermission, isAdmin, type AuthSession } from '../auth';
import { PERMISSION_RESOURCES, type RolePermissions } from '../permissions';

/** Every resource denied — derived from the model so adding one cannot skew a test. */
const NONE = Object.fromEntries(
  PERMISSION_RESOURCES.map((resource) => [resource, { read: false, write: false, delete: false }])
) as unknown as RolePermissions;

function session(
  permissions: Partial<RolePermissions>,
  systemRole = 'standard'
): AuthSession {
  const merged = { ...NONE, ...permissions };
  return {
    user: {
      id: 'u1',
      email: 'staff@example.com',
      name: 'Staff',
      roleIds: ['r1'],
      roles: [{ id: 'r1', name: 'Role', systemRole, permissions: merged }],
    },
    permissions: merged,
  };
}

describe('hasPermission', () => {
  it('refuses when there is no session', () => {
    expect(hasPermission(null, 'inventory', 'read')).toBe(false);
  });

  it('allows the exact granted action', () => {
    expect(hasPermission(session({ inventory: { read: true, write: false, delete: false } }), 'inventory', 'read')).toBe(true);
  });

  it('does not let read imply write or delete', () => {
    const s = session({ inventory: { read: true, write: false, delete: false } });

    expect(hasPermission(s, 'inventory', 'write')).toBe(false);
    expect(hasPermission(s, 'inventory', 'delete')).toBe(false);
  });

  it('does not let a grant on one resource carry to another', () => {
    const s = session({ inventory: { read: true, write: true, delete: true } });

    expect(hasPermission(s, 'customers', 'read')).toBe(false);
  });

  it('lets an admin through without an explicit grant', () => {
    // Mirrors the server's requirePermission, so the UI does not hide a control
    // the API would in fact accept.
    expect(hasPermission(session({}, 'admin'), 'settings', 'delete')).toBe(true);
  });

  it('returns false rather than throwing when a resource key is absent', () => {
    const s = session({});
    delete (s.permissions as Partial<RolePermissions>).customers;

    expect(hasPermission(s, 'customers', 'read')).toBe(false);
  });
});

describe('isAdmin', () => {
  it('is false for a null session and for non-admin roles', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(session({}, 'supervisor'))).toBe(false);
  });

  it('is true when any role is the admin archetype', () => {
    expect(isAdmin(session({}, 'admin'))).toBe(true);
  });
});
