import bcrypt from 'bcryptjs';
import type { DbRow } from '../adapters/db/types';
import type { DatabaseAdapter } from './database';
import { BCRYPT_ROUNDS } from './hashing';

/**
 * PIN-based cashier identification.
 *
 * A PIN is a weak secret by design — a short, numeric code typed in public,
 * on a screen other people standing at the till can see. It is not a
 * password substitute and it never mints a session (see
 * `services/registerShifts.ts`): it only says who is standing at an
 * already-authenticated till right now. Everything here follows the same
 * house style as `services/registerEnrolment.ts` — discriminated results
 * instead of thrown errors for expected outcomes, and bcrypt handled the
 * same way passwords are.
 */



/**
 * Absolute floor, regardless of what `organizations.pin_length` says. See
 * {@link setPin}: the effective minimum used to validate a PIN is
 * `Math.max(MIN_PIN_LENGTH, policy.pinLength)`, so even a corrupt or
 * misconfigured org row can never push the real floor below this.
 */
export const MIN_PIN_LENGTH = 6;

const PIN_MAX_FAILURES = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000;

/**
 * A bcrypt hash of a value nothing will ever type, computed once at module
 * load — see `registerEnrolment.ts`'s `DUMMY_HASH` for the full reasoning.
 * Used so a PIN that matches no one, and a request for a user with no PIN
 * set at all, take the same time as a wrong PIN for a real account.
 */
const DUMMY_PIN_HASH = bcrypt.hashSync('no-such-pin-000000', BCRYPT_ROUNDS);

const DIGITS_ONLY = /^\d+$/;

/** Timing-safe placeholder compare, for a miss path with no real hash to check against. */
export async function dummyPinCompare(pin: string): Promise<void> {
  await bcrypt.compare(pin, DUMMY_PIN_HASH);
}

export type SetPinResult = DbRow | 'too_short' | 'not_numeric' | 'in_use';

/**
 * Set (or replace) a user's PIN.
 *
 * Uniqueness is enforced here, not in the schema: bcrypt salts mean two
 * users who typed the identical PIN hash to two different values, so no
 * unique index can ever catch it. Instead, the candidate is compared against
 * every active PIN-holder in the org — O(n) bcrypt compares, one per
 * employee. That is fine at the scale this runs at (a few hundred users per
 * org); it would not be fine at thousands, at which point this needs an
 * index of some kind rather than a linear scan.
 */
export async function setPin(
  adapter: DatabaseAdapter,
  orgId: string,
  userId: string,
  rawPin: string
): Promise<SetPinResult> {
  if (!DIGITS_ONLY.test(rawPin)) return 'not_numeric';

  const policy = await adapter.getOrgPolicy(orgId);
  // Defensive floor: even if `organizations.pin_length` were somehow set
  // below the minimum, the effective length checked here never is.
  const minLength = Math.max(MIN_PIN_LENGTH, policy?.pinLength ?? MIN_PIN_LENGTH);
  if (rawPin.length < minLength) return 'too_short';

  const activeUsers = await adapter.getActiveUsersWithPin(orgId);
  for (const candidate of activeUsers) {
    if (String(candidate.id) === userId) continue;
    if (typeof candidate.pinHash !== 'string') continue;
    const collides = await bcrypt.compare(rawPin, candidate.pinHash);
    if (collides) return 'in_use';
  }

  const pinHash = await bcrypt.hash(rawPin, BCRYPT_ROUNDS);
  const updated = await adapter.setUserPin(userId, { pinHash, pinSetAt: Date.now() });
  if (!updated) {
    // Not part of the discriminated vocabulary above: a userId that does not
    // exist is a caller bug (the route is expected to have loaded the user
    // already), not a normal PIN-validation outcome.
    throw new Error(`setPin: no user found for id ${userId}`);
  }
  return updated;
}

/**
 * Remove a user's PIN, revoking their ability to sign on to any till.
 *
 * Separate from `setPin` rather than a null-accepting overload of it, because
 * the two are different acts with different authorisation stories: setting a
 * PIN hands someone the ability to ring sales under their own name, clearing it
 * takes that away. A route that means to revoke should not be one mistyped
 * argument away from issuing instead.
 *
 * Returns null when no such user exists, so the route can 404 rather than
 * silently reporting success for an id that was never there.
 */
export async function clearPin(
  adapter: DatabaseAdapter,
  userId: string
): Promise<DbRow | null> {
  return adapter.setUserPin(userId, { pinHash: null, pinSetAt: null });
}

export type VerifyPinResult = { user: DbRow } | 'no_pin' | 'locked' | 'bad_pin';

/**
 * Verify a PIN against a SPECIFIC, already-known user — the one primitive
 * that owns lockout state, and the one place `pin_failed_count` /
 * `pin_locked_until` are ever read or written.
 *
 * Deliberately takes a `userId` rather than scanning an org: a scan cannot
 * attribute a miss to any one account (a PIN that matches nobody could be a
 * typo by any employee), and counting a miss against every candidate would
 * turn one wrong guess into a mass lockout of the entire roster. Locking a
 * specific account on repeated failure only makes sense once the account is
 * already known — see `registerShifts.startShift`, which identifies the
 * candidate by hash first and only then calls this to apply lockout
 * bookkeeping.
 */
export async function verifyPin(
  adapter: DatabaseAdapter,
  userId: string,
  rawPin: string
): Promise<VerifyPinResult> {
  const user = await adapter.getUserById(userId);
  if (!user || typeof user.pinHash !== 'string') {
    await dummyPinCompare(rawPin);
    return 'no_pin';
  }

  const lockedUntil = user.pinLockedUntil == null ? null : Number(user.pinLockedUntil);
  const isLocked = lockedUntil != null && lockedUntil > Date.now();

  // Always compare, even against an already-locked account, so response
  // timing cannot distinguish "locked" from "checked and failed" from "no
  // PIN set" — see DUMMY_PIN_HASH above for the same reasoning on a miss.
  const isMatch = await bcrypt.compare(rawPin, user.pinHash);

  if (isLocked) return 'locked';

  if (!isMatch) {
    const failedCount = Number(user.pinFailedCount ?? 0) + 1;

    if (failedCount >= PIN_MAX_FAILURES) {
      const newLockedUntil = Date.now() + PIN_LOCKOUT_MS;
      await adapter.recordPinFailure(userId, { failedCount, lockedUntil: newLockedUntil });
      // Written directly via the adapter, not through the req-based `audit()`
      // wrapper in `services/audit.ts`: a lockout must be recorded regardless
      // of which surface triggered it, and there is no authenticated actor to
      // attribute it to — the "who" this entry is about IS the account being
      // locked, the same reasoning `POST /api/registers/pair` uses to audit a
      // credential going live with no `req.user` at all.
      await adapter.createAuditLog({
        userId: null,
        action: 'update',
        entity: 'user',
        entityId: userId,
        after: { pinLockedUntil: newLockedUntil, pinFailedCount: failedCount, reason: 'pin_lockout' },
      });
      return 'locked';
    }

    await adapter.recordPinFailure(userId, { failedCount, lockedUntil: null });
    return 'bad_pin';
  }

  await adapter.resetPinFailures(userId);
  return { user };
}
