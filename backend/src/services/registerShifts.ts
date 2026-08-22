import bcrypt from 'bcryptjs';
import type { DbRow } from '../adapters/db/types';
import type { DatabaseAdapter } from './database';
import { dummyPinCompare, verifyPin } from './pins';

/**
 * Register shifts: which employee is standing at which till, right now.
 *
 * A shift replaces the Phase-1 placeholder that stamped every order with
 * `req.user.id` — the authenticated *user*, whoever logged this browser in,
 * possibly hours ago and possibly not the person ringing the sale. A shift
 * is opened by entering a PIN and closed by signing out or going idle. It is
 * deliberately not a session: see `services/pins.ts` and migration 018.
 */

export type EndShiftReason = 'signed_out' | 'idle_timeout' | 'superseded' | 'revoked' | 'forced';

/**
 * Fallback only — every register created since migration 015 has an
 * explicit `idle_lock_seconds` (default 300), so this is reached only if a
 * shift somehow outlives its register between reads.
 */
const DEFAULT_IDLE_LOCK_SECONDS = 300;

/**
 * The register's open shift, if it has one — and the ONLY place idle expiry
 * is decided. There is no background job in this app, so an idle shift is
 * not ended by a scheduler; it is ended lazily, the next time anything asks
 * "is a shift open here", by comparing `last_activity_at` against the
 * register's own `idle_lock_seconds`. This matters: without a lazy check
 * here, an expired shift would keep authenticating sales until *something
 * else* happened to touch it, which defeats the point of an idle timeout.
 *
 * Every other function in this module that needs "the current shift" goes
 * through this one, so idle expiry is applied uniformly rather than
 * separately in each caller.
 */
export async function getOpenShift(adapter: DatabaseAdapter, registerId: string): Promise<DbRow | null> {
  const shift = await adapter.getOpenShiftForRegister(registerId);
  if (!shift) return null;

  const register = await adapter.getRegisterById(registerId);
  const idleLockSeconds = register ? Number(register.idleLockSeconds) : DEFAULT_IDLE_LOCK_SECONDS;
  const idleThresholdMs = idleLockSeconds * 1000;

  const lastActivityAt = Number(shift.lastActivityAt);
  if (Date.now() - lastActivityAt >= idleThresholdMs) {
    await adapter.endRegisterShift(String(shift.id), 'idle_timeout');
    return null;
  }

  return shift;
}

export interface StartShiftInput {
  registerId: string;
  pin: string;
  /**
   * Cashier an admin is standing in for, when this shift was opened by
   * `POST /api/auth/till/assume` rather than a PIN scan. Recorded on the
   * shift for the audit trail — see migration 020 — and never the attributed
   * identity: the shift's `userId` is always who actually opened it.
   */
  emulatedUserId?: string;
}

export type StartShiftResult =
  | { shift: DbRow; user: DbRow; supersededShiftId: string | null }
  | 'register_not_found'
  | 'register_not_active'
  | 'bad_pin'
  | 'locked';

/**
 * Sign a cashier on to a register with a PIN.
 *
 * Identification is a scan, not a lookup: the till has no username field,
 * only a PIN pad, so "whose PIN is this" is answered by comparing the
 * entered PIN against every active PIN-holder in the org — mirroring how
 * `registerEnrolment.redeemPairingCode` compares every prefix match rather
 * than trusting the first hit. `setPin` enforces org-wide uniqueness, so at
 * most one candidate can legitimately match; every candidate is still
 * compared, not just until the first match, for the same timing reason.
 *
 * A PIN that matches nobody is NOT attributed to any specific account and
 * does not touch any account's failure counter — see `pins.verifyPin` for
 * why: counting a blind miss against every candidate would let one wrong
 * guess lock out the entire roster. Once a hash does match, the rest of the
 * lockout bookkeeping (including the case where that specific account is
 * already locked from a prior direct check) is handed off to
 * `pins.verifyPin`, the single place that state lives.
 */
export async function startShift(
  adapter: DatabaseAdapter,
  input: StartShiftInput
): Promise<StartShiftResult> {
  const register = await adapter.getRegisterById(input.registerId);
  if (!register) return 'register_not_found';
  if (register.status !== 'active') return 'register_not_active';

  const orgId = String(register.orgId);

  const candidates = await adapter.getActiveUsersWithPin(orgId);
  let matchedId: string | null = null;
  for (const candidate of candidates) {
    if (typeof candidate.pinHash !== 'string') continue;
    const isMatch = await bcrypt.compare(input.pin, candidate.pinHash);
    if (isMatch) matchedId = String(candidate.id);
  }

  if (!matchedId) {
    await dummyPinCompare(input.pin);
    return 'bad_pin';
  }

  const verified = await verifyPin(adapter, matchedId, input.pin);
  if (verified === 'locked') return 'locked';
  if (verified === 'no_pin' || verified === 'bad_pin') {
    // Shouldn't happen — the scan above just matched this exact hash — but
    // fail closed rather than assume the second check must agree.
    return 'bad_pin';
  }

  const user = verified.user;

  // Supersede whatever was open before opening the new one. Goes through
  // `getOpenShift`, not a raw fetch, so a shift that is merely idle-expired
  // is ended as `idle_timeout` (its true cause) rather than being
  // overwritten as `superseded` — the previous cashier walking away is the
  // common case, not an edge case, but it is not what happened here if the
  // clock is what actually ended their shift.
  const openShift = await getOpenShift(adapter, input.registerId);
  let supersededShiftId: string | null = null;
  if (openShift) {
    await adapter.endRegisterShift(String(openShift.id), 'superseded');
    supersededShiftId = String(openShift.id);
  }

  const shift = await adapter.createRegisterShift({
    registerId: input.registerId,
    userId: String(user.id),
    emulatedUserId: input.emulatedUserId,
  });

  return { shift, user, supersededShiftId };
}

/** End a shift for a stated reason. A no-op (returns null) if it was already ended. */
export async function endShift(
  adapter: DatabaseAdapter,
  shiftId: string,
  reason: EndShiftReason
): Promise<DbRow | null> {
  return adapter.endRegisterShift(shiftId, reason);
}

/** Bump a shift's idle clock. Call on every successful register-authenticated action. */
export async function touchShift(adapter: DatabaseAdapter, shiftId: string): Promise<DbRow | null> {
  return adapter.touchRegisterShiftActivity(shiftId);
}
