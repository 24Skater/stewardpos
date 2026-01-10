import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { UnauthorizedError, ForbiddenError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';

/**
 * Authorization middleware - checks if authenticated user has required role(s)
 * @param allowedRoles - Array of role names (e.g., 'admin', 'manager') that are allowed
 */
export function authorize(allowedRoles: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const userRoleIds = req.user.roleIds || [];
      
      if (userRoleIds.length === 0) {
        throw new ForbiddenError('No roles assigned');
      }

      // Get the role objects from database to check their systemRole/name
      const adapter = db.getAdapter();
      
      let hasRequiredRole = false;
      for (const roleId of userRoleIds) {
        try {
          const role = await adapter.getRoleById(roleId);
          if (role) {
            const roleName = role.systemRole || role.name;
            if (allowedRoles.includes(roleName?.toLowerCase() || '')) {
              hasRequiredRole = true;
              break;
            }
          }
        } catch (e) {
          logger.warn(`Could not fetch role ${roleId}:`, e);
        }
      }

      if (!hasRequiredRole) {
        throw new ForbiddenError(`Access denied. Required roles: ${allowedRoles.join(', ')}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

