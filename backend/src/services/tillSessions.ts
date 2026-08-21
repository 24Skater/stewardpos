import jwt from 'jsonwebtoken';
import config from '../config';
import { DEFAULT_ORG_ID } from '../api/middleware/auth';

/**
 * How long an assumed session lives, in seconds.
 *
 * An assumed session bypasses device pairing, so unlike a real till session it
 * is not bounded by someone walking away from a physical terminal. Thirty
 * minutes means a forgotten one closes itself.
 */
export const TILL_SESSION_MAX_AGE = 30 * 60;

export interface SessionUser {
  id: string;
  email: string;
  roleIds: string[];
  orgId?: string;
}

export interface MintSessionInput {
  user: SessionUser;
  /** Present on a PIN session: binds the token's life to the shift's. */
  shiftId?: string;
  /** Present on any till session, including a no-PIN one that has no shift. */
  registerId?: string;
  /** Overrides `config.jwt.expiresIn`. Used only by `assume`. */
  maxAgeSeconds?: number;
}

/**
 * Mint a session token.
 *
 * The single place a JWT is created, so the claim shape cannot drift between
 * the password login, a till sign-on, and an assumed session — `authenticate`
 * reads all three through one `TokenClaims` type.
 *
 * `shiftId` and `registerId` are omitted rather than set to null when absent:
 * `authenticate` branches on their presence, and a null would read as present.
 */
export function mintSession(input: MintSessionInput): { token: string; expiresIn: string } {
  const expiresIn = input.maxAgeSeconds ? `${input.maxAgeSeconds}s` : config.jwt.expiresIn;

  // jsonwebtoken's SignOptions type narrows `expiresIn` to `@types/ms`'s
  // StringValue union, which a plain `string` doesn't satisfy even though the
  // runtime accepts one (e.g. "24h", "1800s") — the same mismatch the route
  // this replaces used to carry as a `@ts-expect-error`. Asserting the type
  // here, once, keeps that suppression out of application code.
  const token = jwt.sign(
    {
      id: input.user.id,
      email: input.user.email,
      roleIds: input.user.roleIds,
      // Carried so a consumer can read the tenant without a lookup. The
      // middleware still prefers the stored value; see there for why.
      orgId: input.user.orgId ?? DEFAULT_ORG_ID,
      ...(input.shiftId ? { shiftId: input.shiftId } : {}),
      ...(input.registerId ? { registerId: input.registerId } : {}),
    },
    config.jwt.secret,
    { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] }
  );

  return { token, expiresIn };
}
