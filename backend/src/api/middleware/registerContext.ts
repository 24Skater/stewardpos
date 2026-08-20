import { AuthRequest, DEFAULT_ORG_ID } from './auth';
import db from '../../services/database';
import { ValidationError, AuthenticationError } from '../../utils/errors';
import logger from '../../utils/logger';
import { verifyDeviceToken } from '../../services/registerEnrolment';
import { REGISTER_TOKEN_INVALID } from './registerErrorCodes';

/** The subset of a register row that money-moving routes need to act on. */
export interface CallerRegister {
  id: string;
  displayCode: string;
  hasCashDrawer: boolean;
  /** Whether this register may take a cash tender at all — a card-only lane says false. */
  acceptsCash: boolean;
  /** Whether this register may process a refund. */
  canRefund: boolean;
  status: string;
  /** Whether a cashier must have an open PIN shift before this register can ring a sale or a return. */
  requireSignIn: boolean;
  /** Whether this register may open its drawer with no sale attached — migration 015, unused until now. */
  canOpenDrawerNoSale: boolean;
  /**
   * The card reader physically attached to this till, and optionally the
   * provider it speaks — both from migration 015, unused until now.
   *
   * Merchant credentials (the secret key, the access token) stay org-wide,
   * because they identify the *account*. A device id identifies a *machine*,
   * and three tills in a shop have three of them. Reading one global device id
   * for every register is why several registers could never take cards at once.
   *
   * Null means "use whatever the store settings say", which is what every
   * existing single-register install does.
   */
  terminalProvider: string | null;
  terminalDeviceId: string | null;
}

function toCallerRegister(register: Record<string, unknown>): CallerRegister {
  return {
    id: String(register.id),
    displayCode: String(register.displayCode),
    hasCashDrawer: Boolean(register.hasCashDrawer),
    acceptsCash: Boolean(register.acceptsCash),
    canRefund: Boolean(register.canRefund),
    status: String(register.status),
    requireSignIn: Boolean(register.requireSignIn),
    canOpenDrawerNoSale: Boolean(register.canOpenDrawerNoSale),
    terminalProvider: (register.terminalProvider as string | null) ?? null,
    terminalDeviceId: (register.terminalDeviceId as string | null) ?? null,
  };
}

function readHeader(req: AuthRequest, name: string): string | null {
  const value = req.headers[name];
  const single = Array.isArray(value) ? value[0] : value;
  return single || null;
}

/**
 * The manager-override grant token, when the caller sent one.
 *
 * Carried as `X-Override-Token` rather than a body field, chosen so every
 * enforcement site (checkout, drawer close, void, no-sale) reads it the same
 * way regardless of how different each endpoint's body schema otherwise is —
 * `services/registerOverrides.ts` is the consumer and knows nothing about
 * HTTP, so the one place a route needs to know the header name is here.
 */
export function readOverrideToken(req: AuthRequest): string | null {
  return readHeader(req, 'x-override-token');
}

/**
 * Resolve which register a request is acting on.
 *
 * Order of resolution:
 *
 * 1. `X-Register-Token` — a verified device credential minted at pairing
 *    (see `services/registerEnrolment.ts`), Phase 3. Authoritative: if
 *    present, it wins outright regardless of what `X-Register-Id` also
 *    says, and its use updates the credential's `last_used_at`. Present but
 *    invalid or revoked rejects with 401 rather than falling through to (2)
 *    or (3) — a revoked device must find out it was revoked on its very
 *    next request, not quietly keep working under the unverified header it
 *    also happens to still be sending.
 * 2. `X-Register-Id`, Phase 2's *unverified claim* — a name any
 *    authenticated browser can send for any register, with no proof behind
 *    it. It must name a register that exists, belongs to the caller's org,
 *    and is `active` — any failure rejects outright rather than falling
 *    through to (3), because silently falling back on a typo'd or cross-org
 *    id would ring a sale against the wrong till without anyone noticing.
 *    Kept only for upgrade safety: a terminal that has not yet enrolled a
 *    device credential has no token to send, and removing this branch today
 *    would fail every checkout on a fleet that hasn't finished enrolling.
 *    Once every terminal is enrolled, this branch should be deleted and a
 *    request with neither header should reject outright rather than fall
 *    through to (3).
 * 3. Otherwise, the org's lowest-numbered `active` register, logged so the
 *    fallback is visible in the logs rather than invisible.
 */
export async function resolveCallerRegister(req: AuthRequest): Promise<CallerRegister> {
  const orgId = req.orgId ?? DEFAULT_ORG_ID;

  const tokenValue = readHeader(req, 'x-register-token');
  if (tokenValue) {
    const result = await verifyDeviceToken(db.getAdapter(), tokenValue);
    if (result === 'invalid' || result === 'revoked') {
      throw new AuthenticationError(
        'X-Register-Token is invalid or has been revoked',
        REGISTER_TOKEN_INVALID
      );
    }
    if (String(result.register.orgId) !== orgId) {
      // Defense in depth: the token already proves a real, unrevoked
      // register, but a session from one org must not be able to act
      // through a device credential belonging to another.
      throw new AuthenticationError(
        'X-Register-Token does not belong to your organization',
        REGISTER_TOKEN_INVALID
      );
    }
    return toCallerRegister(result.register);
  }

  const headerId = readHeader(req, 'x-register-id');
  if (headerId) {
    const register = await db.getAdapter().getRegisterById(headerId);
    if (!register || String(register.orgId) !== orgId || register.status !== 'active') {
      throw new ValidationError(
        'X-Register-Id does not identify an active register in your organization'
      );
    }
    return toCallerRegister(register);
  }

  const candidates = await db.getAdapter().getRegisters({ orgId, status: 'active' });
  const fallback = [...candidates].sort(
    (a, b) => Number(a.registerNumber) - Number(b.registerNumber)
  )[0];

  if (!fallback) {
    throw new ValidationError('Your organization has no active register to use');
  }

  logger.info(
    `No X-Register-Token or X-Register-Id sent; falling back to register ${fallback.displayCode} (${fallback.id})`
  );
  return toCallerRegister(fallback);
}
