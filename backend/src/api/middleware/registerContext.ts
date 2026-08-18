import { AuthRequest, DEFAULT_ORG_ID } from './auth';
import db from '../../services/database';
import { ValidationError } from '../../utils/errors';
import logger from '../../utils/logger';

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
}

function toCallerRegister(register: Record<string, unknown>): CallerRegister {
  return {
    id: String(register.id),
    displayCode: String(register.displayCode),
    hasCashDrawer: Boolean(register.hasCashDrawer),
    acceptsCash: Boolean(register.acceptsCash),
    canRefund: Boolean(register.canRefund),
    status: String(register.status),
  };
}

/**
 * Resolve which register a request is acting on.
 *
 * Order of resolution:
 *
 * 1. `X-Register-Id`, if the caller sent one. It must name a register that
 *    exists, belongs to the caller's org, and is `active` — any failure
 *    rejects outright rather than falling through to (2), because silently
 *    falling back on a typo'd or cross-org id would ring a sale against the
 *    wrong till without anyone noticing.
 * 2. Otherwise, the org's lowest-numbered `active` register, logged so the
 *    fallback is visible in the logs rather than invisible.
 *
 * The fallback exists for upgrade safety: an existing deployment's POS does
 * not send this header yet, and without a fallback every checkout would start
 * failing the moment this deploys. Device enrolment (a later phase) makes the
 * header authoritative for every caller, at which point this fallback should
 * be removed and a missing header should reject outright.
 */
export async function resolveCallerRegister(req: AuthRequest): Promise<CallerRegister> {
  const orgId = req.orgId ?? DEFAULT_ORG_ID;
  const headerValue = req.headers['x-register-id'];
  const headerId = Array.isArray(headerValue) ? headerValue[0] : headerValue;

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
    `No X-Register-Id sent; falling back to register ${fallback.displayCode} (${fallback.id})`
  );
  return toCallerRegister(fallback);
}
