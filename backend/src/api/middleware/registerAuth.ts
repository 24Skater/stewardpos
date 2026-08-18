import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { AuthenticationError, ForbiddenError } from '../../utils/errors';
import db from '../../services/database';
import { verifyDeviceToken } from '../../services/registerEnrolment';
import { REGISTER_TOKEN_INVALID } from './registerErrorCodes';

/**
 * Device-credential authentication.
 *
 * `X-Register-Token` is the credential minted at pairing (see
 * `services/registerEnrolment.ts`) — proof that the caller is the specific
 * physical till it claims to be, not merely a browser that named one via the
 * unverified `X-Register-Id` header. It authenticates a DEVICE, not a
 * person, which is why this is a separate middleware from `authenticate` in
 * `auth.ts`: a heartbeat has no user behind it at all, so routing it through
 * session/API-key authentication is not an option, only a workaround.
 */

export interface AuthenticatedRegisterRequest extends AuthRequest {
  /** The register the presented `X-Register-Token` proves the caller is. */
  tokenRegister?: Record<string, unknown>;
}

function readRegisterToken(req: AuthRequest): string | null {
  const header = req.headers['x-register-token'];
  const value = Array.isArray(header) ? header[0] : header;
  return value || null;
}

/**
 * Require a valid, unrevoked `X-Register-Token`.
 *
 * Missing, unknown, and revoked all reject with the same 401 — the entire
 * point of a credential that can be destroyed is that a revoked device
 * finds out on its very next request, rather than quietly keeping working
 * until someone notices its heartbeats stopped meaning anything.
 */
export async function requireRegisterToken(
  req: AuthenticatedRegisterRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = readRegisterToken(req);
    if (!token) {
      throw new AuthenticationError('X-Register-Token is required', REGISTER_TOKEN_INVALID);
    }

    const result = await verifyDeviceToken(db.getAdapter(), token);
    if (result === 'invalid' || result === 'revoked') {
      throw new AuthenticationError(
        'X-Register-Token is invalid or has been revoked',
        REGISTER_TOKEN_INVALID
      );
    }

    req.tokenRegister = result.register;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Require that the token verified by {@link requireRegisterToken} names the
 * SAME register as the route's `:id` param.
 *
 * `requireRegisterToken` only proves the caller is SOME enrolled register;
 * without this, register A's token could act on register B's URL — across
 * an org boundary, since a token's own org is never checked against the
 * caller's, there being no authenticated caller session at all on these
 * routes to check it against.
 */
export function requireMatchingRegister(
  req: AuthenticatedRegisterRequest,
  _res: Response,
  next: NextFunction
): void {
  if (!req.tokenRegister || String(req.tokenRegister.id) !== req.params.id) {
    next(new ForbiddenError('This token does not authenticate this register'));
    return;
  }
  next();
}
