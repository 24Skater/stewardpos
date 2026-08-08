import { describe, it, expect } from 'vitest';
import { hasPermission, isAdmin, hasAnyRole, hasRole, type AuthSession } from '../auth';
import { PERMISSION_RESOURCES, type RolePermissions } from '../permissions';

/**
 * Client-side permission checks.
 *
 * These decide what the UI *offers*; the server decides what it accepts. A
 * mismatch is not a security hole — the server still refuses — but it shows up
 * as a button that always 403s, or a feature a permitted user cannot find.
 * Both are the kind of thing nobody reports as a bug, they just stop using it.
 */
/**
 * A complete `RolePermissions`, denied throughout except where stated.
 *
 * The type requires every resource key, and building it from
 * `PERMISSION_RESOURCES` means a resource added to the model later shows up
 * here denied — which is what the real merge does — rather than being missing
 * and failing to compile in a way that invites filling it in by hand.
 */
function permissions(granted: Partial<RolePermissions> = {}): RolePermissions {
  return {
    // `Object.fromEntries` widens the key type to `string`, which no longer
    // overlaps `RolePermissions` enough for a direct assertion.
    ...(Object.fromEntries(
      PERMISSION_RESOURCES.map((resource) => [
        resource,
        { read: false, write: false, delete: false },
      ])
    ) as unknown as RolePermissions),
    ...granted,
  };
}

function session(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    user: {
      id: 'u1',
      email: 'cashier@example.com',
      name: 'Cashier',
      roleIds: ['r1'],
      roles: [{ id: 'r1', name: 'Cashier', systemRole: 'standard', permissions: permissions() }],
    },
    permissions: permissions(),
    ...overrides,
  } as AuthSession;
}

describe('hasPermission', () => {
  it('grants what the permissions say', () => {
    const actor = session({ permissions: permissions({ orders: { read: true, write: false, delete: false } }) });

    expect(hasPermission(actor, 'orders', 'read')).toBe(true);
  });

  it('denies what they do not', () => {
    const actor = session({ permissions: permissions({ orders: { read: true, write: false, delete: false } }) });

    expect(hasPermission(actor, 'orders', 'write')).toBe(false);
  });

  it('denies a resource the session says nothing about', () => {
    // Absent must mean denied, not "unset, so allow" — a resource added to the
    // model later would otherwise be open to everyone until someone noticed.
    expect(hasPermission(session(), 'inventory', 'read')).toBe(false);
  });

  it('denies an anonymous caller', () => {
    expect(hasPermission(null, 'orders', 'read')).toBe(false);
  });

  it('lets an admin through regardless', () => {
    // Matches the server's `requirePermission`: a resource key added later must
    // not lock out the account that has to configure it.
    const admin = session({
      user: {
        ...session().user,
        roles: [{ id: 'r1', name: 'Owner', systemRole: 'admin', permissions: permissions() }],
      },
    });

    expect(hasPermission(admin, 'settings', 'delete')).toBe(true);
  });

  it('treats a non-boolean permission value as denied', () => {
    // Only an explicit `true` grants. Anything else — a truthy string from a
    // malformed payload — must not become access.
    const actor = session({
      permissions: permissions({
        orders: { read: 'yes' as unknown as boolean, write: false, delete: false },
      }),
    });

    expect(hasPermission(actor, 'orders', 'read')).toBe(false);
  });
});

describe('isAdmin', () => {
  it('recognises the admin system role', () => {
    const admin = session({
      user: { ...session().user, roles: [{ id: 'r1', name: 'X', systemRole: 'admin', permissions: permissions() }] },
    });

    expect(isAdmin(admin)).toBe(true);
  });

  it('is not fooled by a role merely named "admin"', () => {
    // The archetype is `systemRole`, not the display name. A shop naming a role
    // "Admin Assistant" must not thereby create an administrator.
    const impostor = session({
      user: {
        ...session().user,
        roles: [{ id: 'r1', name: 'admin', systemRole: 'standard', permissions: permissions() }],
      },
    });

    expect(isAdmin(impostor)).toBe(false);
  });

  it('handles a session with no roles', () => {
    const actor = session({ user: { ...session().user, roles: [] } });

    expect(isAdmin(actor)).toBe(false);
  });

  it('handles no session at all', () => {
    expect(isAdmin(null)).toBe(false);
  });
});

describe('hasAnyRole', () => {
  it('matches on the system role', () => {
    expect(hasAnyRole(session(), ['standard'])).toBe(true);
  });

  it('falls back to the display name when there is no system role', () => {
    const actor = session({
      user: { ...session().user, roles: [{ id: 'r1', name: 'Bench Tech', permissions: permissions() }] },
    });

    expect(hasAnyRole(actor, ['Bench Tech'])).toBe(true);
  });

  it('is false when none match', () => {
    expect(hasAnyRole(session(), ['manager', 'owner'])).toBe(false);
  });

  it('is false for an anonymous caller', () => {
    expect(hasAnyRole(null, ['standard'])).toBe(false);
  });

  it('hasRole is the single-name case', () => {
    expect(hasRole(session(), 'standard')).toBe(true);
    expect(hasRole(session(), 'owner')).toBe(false);
  });
});
