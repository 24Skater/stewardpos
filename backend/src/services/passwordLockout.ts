import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import type { DbRow } from '../adapters/db/types';
import type { DatabaseAdapter } from './database';
import config from '../config';
import { BCRYPT_ROUNDS } from './hashing';

/**
 * Per-account lockout for password sign-in.
 *
 * A cashier's PIN has had this since migration 018 — five wrong guesses and the
 * account stops answering for fifteen minutes (`services/pins.ts`). A password
 * had nothing but `loginLimiter`, which counts per IP. An attacker with a few
 * hundred addresses therefore had, in effect, unlimited attempts against any
 * one account, while the six-digit PIN beside it was properly defended.
 *
 * The asymmetry ran the wrong way. Until `services/passwordPolicy.ts` landed,
 * `POST /api/admin/users` accepted six characters, so accounts created under
 * the old rule may hold passwords no stronger than a PIN — with none of a PIN's
 * protection. Raising the policy does not help them; it governs passwords being
 * chosen, not the ones already set.
 *
 * ## On locking people out of their own shop
 *
 * Any account lockout is a denial-of-service primitive: anyone who knows an
 * address can hold that account shut by failing on purpose. Accepted here, for
 * a reason specific to this application — **password sign-in is not on the path
 * to taking money.** Cashiers work the till with a PIN against an already-paired
 * register (`api/routes/till.ts`), and `POST /api/auth/login` refuses a
 * till-only user outright. So a locked password account costs somebody the
 * back office for fifteen minutes; it does not stop the shop trading.
 *
 * A manager can also clear it immediately —
 * `POST /api/admin/users/:id/password/unlock`, the sibling of the PIN unlock
 * that already exists for the same reason.
 *
 * ## What the caller is told
 *
 * Nothing, normally. A locked account answers exactly as a wrong password does,
 * because "this account is locked" confirms the address exists — the same
 * enumeration leak the decoy comparison in `api/routes/auth.ts` closes on the
 * timing side, and it would be perverse to close it there and reopen it here.
 *
 * The one exception is a caller who supplies the **correct** password while
 * locked. They have proved they are not guessing, so they are told how long is
 * left rather than being left to wonder whether they have forgotten it. They
 * are still not let in: a lockout that the right password walks through would
 * protect nothing, since a successful guess is exactly what it exists to
 * prevent.
 */

/** Outcome of a password check, with the lockout bookkeeping already applied. */
export type PasswordLoginResult =
  | { outcome: 'ok'; user: DbRow }
  /** Wrong password, no such account, or locked-and-still-wrong. Say nothing. */
  | { outcome: 'invalid' }
  /** Right password, but the account is locked. Safe to say so. */
  | { outcome: 'locked'; until: number };

/**
 * A hash of 32 random bytes, so nothing a caller can send will ever match it.
 *
 * Built lazily rather than at import for the same reason as the decoy in
 * `api/routes/auth.ts`: it costs a full bcrypt, and every module that imports
 * this one would otherwise pay for it at load time.
 */
let decoyHash: string | null = null;

function getDecoyHash(): string {
  if (decoyHash === null) {
    decoyHash = bcrypt.hashSync(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
  }
  return decoyHash;
}

/** Spend what a real verification would, and fail. Always returns false. */
export async function burnPasswordComparison(password: string): Promise<false> {
  await bcrypt.compare(password, getDecoyHash());
  return false;
}

/** Epoch milliseconds, from whichever shape the adapter returned. */
function asEpochMs(value: unknown): number | null {
  if (value == null) return null;
  const millis = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(millis) ? millis : null;
}

/**
 * Check a password and apply lockout, for an account already resolved by email.
 *
 * The single place `password_failed_count` / `password_locked_until` are read
 * or written, mirroring `verifyPin`'s ownership of the PIN equivalents. Keeping
 * it in one function is what stops a second sign-in surface growing its own
 * slightly different rules.
 */
export async function verifyPasswordLogin(
  adapter: DatabaseAdapter,
  user: DbRow | null,
  password: string
): Promise<PasswordLoginResult> {
  // No account, or a row with no usable hash. Burn a comparison so this costs
  // what a real check costs, then answer exactly as a wrong password does.
  if (!user || typeof user.passwordHash !== 'string') {
    await burnPasswordComparison(password);
    return { outcome: 'invalid' };
  }

  const userId = String(user.id);
  const lockedUntil = asEpochMs(user.passwordLockedUntil);
  const isLocked = lockedUntil != null && lockedUntil > Date.now();

  // Compared even when already locked, so that response timing cannot
  // distinguish "locked" from "checked and failed" — the same reasoning
  // `verifyPin` gives for the identical line.
  const isMatch = await bcrypt.compare(password, user.passwordHash);

  if (isLocked) {
    // A correct password while locked is the one case worth explaining: the
    // caller has demonstrated they are not the one guessing. Still refused.
    // The failure count is deliberately not incremented here — the account is
    // already shut, and counting further would let an attacker extend somebody
    // else's lockout indefinitely.
    return isMatch ? { outcome: 'locked', until: lockedUntil } : { outcome: 'invalid' };
  }

  if (!isMatch) {
    const failedCount = Number(user.passwordFailedCount ?? 0) + 1;

    if (failedCount >= config.security.passwordMaxFailures) {
      const newLockedUntil = Date.now() + config.security.passwordLockoutMs;
      await adapter.recordPasswordFailure(userId, {
        failedCount,
        lockedUntil: newLockedUntil,
      });

      // Written straight to the adapter rather than through the req-based
      // `audit()` wrapper: there is no authenticated actor on a failed login,
      // and the "who" this entry concerns IS the account being locked. Same
      // reasoning `verifyPin` uses for the PIN lockout entry.
      await adapter.createAuditLog({
        userId: null,
        action: 'update',
        entity: 'user',
        entityId: userId,
        after: {
          passwordLockedUntil: newLockedUntil,
          passwordFailedCount: failedCount,
          reason: 'password_lockout',
        },
      });

      return { outcome: 'invalid' };
    }

    await adapter.recordPasswordFailure(userId, { failedCount, lockedUntil: null });
    return { outcome: 'invalid' };
  }

  // Only a clean success clears the counter. Doing it on any answered request
  // would mean a single correct guess wiped the record of everything before it.
  await adapter.resetPasswordFailures(userId);
  return { outcome: 'ok', user };
}
