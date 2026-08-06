import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../../config';
import db from '../../services/database';
import { AuthenticationError } from '../../utils/errors';

/** A role as it hangs off the authenticated user. */
export interface AuthRole {
  id: string;
  name: string;
  systemRole?: string;
  permissions?: Record<string, { read?: boolean; write?: boolean; delete?: boolean }>;
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    roleIds: string[];
    /**
     * Loaded from the database on every request, not read out of the token, so
     * a role or permission change takes effect immediately rather than at the
     * next login.
     */
    roles: AuthRole[];
  };
}

/** What `POST /api/auth/login` signs into the token. */
interface TokenClaims {
  id: string;
  email: string;
  roleIds: string[];
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;

  const token = header.substring(7).trim();
  return token || null;
}

/**
 * Verify the token and load the user behind it.
 *
 * The database read is the point: a token stays cryptographically valid until it
 * expires, so trusting its claims alone means a deactivated or deleted account
 * keeps full access for the rest of the token's lifetime. Loading the user lets
 * `status !== 'active'` and deletion take effect on the next request.
 *
 * Failures are deliberately indistinguishable to the caller - a missing token, a
 * forged one, a deleted user, and a suspended user all return the same 401, so
 * the endpoint cannot be used to probe which accounts exist.
 */
export async function authenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const token = readBearerToken(req);
    if (!token) {
      throw new AuthenticationError('Not authenticated');
    }

    let claims: TokenClaims;
    try {
      claims = jwt.verify(token, config.jwt.secret) as TokenClaims;
    } catch (error) {
      // TokenExpiredError extends JsonWebTokenError, so it has to be tested
      // first or an expired token reports itself as merely invalid.
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('Session expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('Not authenticated');
      }
      throw error;
    }

    const user = await db.getAdapter().getUserByEmail(claims.email);
    if (!user || user.status !== 'active') {
      throw new AuthenticationError('Not authenticated');
    }

    req.user = {
      id: String(user.id),
      email: String(user.email),
      roleIds: (user.roleIds as string[]) || [],
      roles: (user.roles as AuthRole[]) || [],
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Attach the user when a valid token is present, but let anonymous callers past.
 *
 * For endpoints whose response varies by caller without requiring one. Any
 * problem - bad token, unknown or suspended user - simply leaves `req.user`
 * unset rather than rejecting.
 */
export async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const token = readBearerToken(req);
    if (!token) return next();

    const claims = jwt.verify(token, config.jwt.secret) as TokenClaims;
    const user = await db.getAdapter().getUserByEmail(claims.email);

    if (user && user.status === 'active') {
      req.user = {
        id: String(user.id),
        email: String(user.email),
        roleIds: (user.roleIds as string[]) || [],
        roles: (user.roles as AuthRole[]) || [],
      };
    }
  } catch {
    // Anonymous is a valid outcome here; never fail the request.
  }

  next();
}
