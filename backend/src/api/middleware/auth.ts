import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import config from '../../config';
import logger from '../../utils/logger';
import db from '../../services/database';
import { AuthenticationError } from '../../utils/errors';

/** A role as it hangs off the authenticated user. */
export interface AuthRole {
  id: string;
  name: string;
  systemRole?: string;
  permissions?: Record<string, { read?: boolean; write?: boolean; delete?: boolean }>;
}

/** Set when a request authenticated with an API key rather than a session. */
export interface AuthenticatedApiKey {
  id: string;
  name: string;
  scopes: ApiKeyScope[];
}

export type ApiKeyScope = 'read' | 'write' | 'delete' | 'admin';

/**
 * The organization every existing row implicitly belongs to.
 *
 * A fixed id, matching migration 014, so the fallback needs no lookup on the
 * request path and a token minted before orgs existed still resolves to a real
 * organization rather than to `undefined`.
 */
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

export interface AuthRequest extends Request {
  apiKey?: AuthenticatedApiKey;
  /**
   * The tenant this request belongs to.
   *
   * Always set on an authenticated request — the default org when the user has
   * none — so a consumer never has to decide what a missing value means. It is
   * not yet used to scope queries; see docs/guides/multi-tenant.md for why the
   * column and the filtering land separately.
   */
  orgId?: string;
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
  /** Absent in tokens minted before orgs existed; falls back to the default. */
  orgId?: string;
}

/**
 * Permissions an API key's scopes grant.
 *
 * Scopes are coarse — they say what a key may *do*, not what to. Expanding them
 * into the same per-resource shape a role carries lets `requirePermission` treat
 * a key and a person identically, rather than growing a second authorisation
 * path that could drift from the first.
 *
 * `admin` maps to the admin archetype, so it bypasses per-resource checks
 * exactly as an admin role does. That is what the scope means, and it is opt-in
 * when the key is minted.
 */
function roleForScopes(scopes: ApiKeyScope[]): AuthRole {
  const canWrite = scopes.includes('write') || scopes.includes('delete');
  const canDelete = scopes.includes('delete');
  const grant = {
    read: scopes.length > 0,
    write: canWrite,
    delete: canDelete,
  };

  const resources = [
    'inventory', 'reports', 'exports', 'settings', 'users',
    'services', 'customers', 'orders', 'returns', 'discounts',
  ];

  return {
    id: 'api-key',
    name: 'API key',
    systemRole: scopes.includes('admin') ? 'admin' : undefined,
    permissions: Object.fromEntries(resources.map((resource) => [resource, grant])),
  };
}

/**
 * Authenticate an `X-API-Key` header, if one is present.
 *
 * Returns `false` when there is no key to try, so the caller can fall through to
 * session auth. A key that is present but bad rejects outright rather than
 * falling through — silently downgrading to "anonymous" would turn a typo in a
 * key into a confusing 401 from somewhere else.
 */
async function authenticateApiKey(req: AuthRequest): Promise<boolean> {
  const presented = req.headers['x-api-key'];
  const key = Array.isArray(presented) ? presented[0] : presented;
  if (!key) return false;

  // `spk_<8 hex>_<64 hex>` — the prefix is indexed, the secret is not stored.
  const prefix = key.split('_').slice(0, 2).join('_');
  const record = await db.getAdapter().getApiKeyByPrefix(prefix);

  if (!record || record.isActive === false) {
    throw new AuthenticationError('Not authenticated');
  }
  if (record.expiresAt != null && record.expiresAt <= Date.now()) {
    throw new AuthenticationError('Not authenticated');
  }
  if (!(await bcrypt.compare(key, String(record.keyHash)))) {
    throw new AuthenticationError('Not authenticated');
  }

  const scopes = (record.scopes as ApiKeyScope[]) ?? ['read'];
  req.apiKey = { id: String(record.id), name: String(record.name), scopes };
  // Keys are not org-scoped yet; they belong to the install, which is one org.
  req.orgId = (record.orgId as string) ?? DEFAULT_ORG_ID;
  req.user = {
    id: `api-key:${record.id}`,
    email: `api-key:${record.name}`,
    roleIds: [],
    roles: [roleForScopes(scopes)],
  };

  // Best-effort: a failure to stamp last-used must not fail the request.
  db.getAdapter()
    .updateApiKeyLastUsed(String(record.id))
    .catch((error: unknown) => logger.warn('Could not record API key usage', error));

  return true;
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
    // An API key is an alternative credential, not a lesser one: it produces the
    // same `req.user` shape so every downstream permission check is unchanged.
    if (await authenticateApiKey(req)) {
      return next();
    }

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

    // The stored value wins over the token's, for the same reason roles are
    // reloaded here: a token outlives a change, and moving a user between orgs
    // should not wait for it to expire.
    req.orgId = (user.orgId as string) ?? claims.orgId ?? DEFAULT_ORG_ID;
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
      req.orgId = (user.orgId as string) ?? claims.orgId ?? DEFAULT_ORG_ID;
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
