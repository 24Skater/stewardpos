import { Response, NextFunction } from 'express';
import { AuthRequest, AuthRole } from './auth';
import { UnauthorizedError, ForbiddenError } from '../../utils/errors';

/**
 * The resources a role can be granted rights over.
 *
 * Mirrors the keys of the `permissions` JSONB on `roles`. Typed as a union so a
 * misspelled resource in a route is a compile error rather than a permission
 * check that silently never passes.
 */
export type PermissionResource =
  | 'inventory'
  | 'reports'
  | 'exports'
  | 'settings'
  | 'users'
  | 'services'
  | 'customers';

export type PermissionAction = 'read' | 'write' | 'delete';

/** True when the user holds a role flagged as the admin archetype. */
function isAdmin(roles: AuthRole[]): boolean {
  return roles.some((role) => role.systemRole === 'admin');
}

function grants(roles: AuthRole[], resource: PermissionResource, action: PermissionAction): boolean {
  return roles.some((role) => role.permissions?.[resource]?.[action] === true);
}

/**
 * Require a specific permission on a resource.
 *
 * Permissions are additive across a user's roles: holding any role that grants
 * the action is enough. Admins bypass the check outright, so a new resource key
 * never accidentally locks out the account that has to configure it.
 *
 * This replaces checking role *names*. That approach had a standing bug -
 * several routes required `['admin', 'manager']`, but no `manager` role has ever
 * been seeded, so those endpoints were admin-only in practice and every
 * supervisor was refused despite holding the matching permission.
 */
export function requirePermission(resource: PermissionResource, action: PermissionAction) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const roles = req.user.roles || [];
      if (isAdmin(roles) || grants(roles, resource, action)) {
        return next();
      }

      throw new ForbiddenError(`You do not have permission to ${action} ${resource}`);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Require one of the named system roles.
 *
 * For the handful of operations that are about *who you are* rather than what
 * you may touch - irreversible deletes, key management. Prefer
 * {@link requirePermission} everywhere else.
 */
export function authorize(allowedSystemRoles: string[]) {
  const allowed = allowedSystemRoles.map((role) => role.toLowerCase());

  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const held = (req.user.roles || []).some((role) => {
        const name = (role.systemRole || role.name || '').toLowerCase();
        return allowed.includes(name);
      });

      if (!held) {
        throw new ForbiddenError(`Access denied. Required roles: ${allowedSystemRoles.join(', ')}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
