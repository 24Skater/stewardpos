import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { DbRow } from '../adapters/db/types';
import type { DatabaseAdapter } from './database';
import { dummyPinCompare, verifyPin } from './pins';
import { getOpenShift } from './registerShifts';

/**
 * Manager overrides: a supervisor authorising exactly one privileged action
 * at a till, without touching the cashier's shift.
 *
 * The problem this solves: a cashier hits a rule that says no — a discount
 * past its approval threshold, a drawer closing short, a void, opening the
 * drawer with no sale — and today the only answer is to log the cashier out
 * and log a supervisor in, which loses the cart and misattributes the sale.
 * An override is a narrow, single-use grant instead: a supervisor enters
 * their PIN, it mints a short-lived credential good for exactly one named
 * action, and the register carries on under the cashier's own shift.
 *
 * Same house style as `services/registerEnrolment.ts` and `services/pins.ts`:
 * discriminated results rather than thrown errors for expected outcomes,
 * bcrypt handled with a constant-time miss path, and no HTTP knowledge here —
 * routes translate each outcome to a status code.
 */

export type OverrideAction = 'discount_approval' | 'drawer_variance' | 'void' | 'no_sale';

const BCRYPT_ROUNDS = 10; // matches pins.ts and registerEnrolment.ts

/** How long a grant is good for. Short on purpose: this authorises one action, not a shift. */
const OVERRIDE_GRANT_TTL_MS = 90 * 1000;

/**
 * A bcrypt hash of a value nothing will ever match, computed once at module
 * load — see `registerEnrolment.ts`'s `DUMMY_HASH` for the full reasoning.
 * Used so an unknown grant prefix takes the same time as a real prefix whose
 * hash simply doesn't match.
 */
const DUMMY_GRANT_HASH = bcrypt.hashSync('no-such-override-grant', BCRYPT_ROUNDS);

interface GeneratedGrant {
  token: string;
  prefix: string;
  hash: string;
}

/** `ovr_<8 hex>_<32 hex>` — same shape as `generateDeviceToken` in registerEnrolment.ts, a different prefix. */
function generateOverrideGrant(): GeneratedGrant {
  const prefix = 'ovr_' + crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(16).toString('hex');
  const token = `${prefix}_${secret}`;
  const hash = bcrypt.hashSync(token, BCRYPT_ROUNDS);
  return { token, prefix, hash };
}

export interface RequestOverrideInput {
  registerId: string;
  action: OverrideAction;
  pin: string;
  /**
   * Who is asking. Defaults to the register's currently signed-on cashier
   * (if a shift is open) — the natural "who is standing here needing this" —
   * so callers only need to pass this explicitly when there is no shift
   * context to infer it from.
   */
  requestedByUserId?: string | null;
  reason?: string | null;
}

export type RequestOverrideResult =
  | { token: string; expiresAt: number; override: DbRow; approver: DbRow }
  | 'register_not_found'
  | 'bad_pin'
  | 'locked';

/**
 * Request a manager-override grant for one action on one register.
 *
 * Identification mirrors `registerShifts.startShift`: the PIN is compared
 * against every candidate, one hash at a time, because a till has no
 * username field. The candidate pool here is narrower than a shift's,
 * though — only users with `can_override` true (migration 018) — so a PIN
 * that matches a real cashier who simply isn't authorised to approve
 * overrides is indistinguishable from a PIN that matches nobody at all. Both
 * fall through to `bad_pin`. That is deliberate: a cashier's own PIN is
 * never in the candidate pool, so it can never be attributed to them or
 * count against their lockout, and the response gives an outside observer no
 * way to learn who in the org *would* be an approver.
 *
 * Once a hash does match, `pins.verifyPin` takes over for lockout
 * bookkeeping — same handoff `startShift` uses — so a supervisor's PIN gets
 * the same brute-force protection a cashier's does.
 *
 * NEVER touches the register's open shift: only reads it, via `getOpenShift`,
 * to learn `shift_id` (for the audit trail) and to default
 * `requestedByUserId` to the cashier currently signed on. Nothing here ends
 * it, supersedes it, or bumps its idle clock — the whole point of an
 * override is that the cashier's shift is not what changed.
 */
export async function requestOverride(
  adapter: DatabaseAdapter,
  input: RequestOverrideInput
): Promise<RequestOverrideResult> {
  const register = await adapter.getRegisterById(input.registerId);
  if (!register) return 'register_not_found';

  const orgId = String(register.orgId);

  const candidates = await adapter.getActiveUsersWithOverridePermission(orgId);
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

  const approver = verified.user;

  // Read-only: see the doc comment above for why this must never mutate the
  // shift it looks at.
  const openShift = await getOpenShift(adapter, input.registerId);
  const requestedByUserId =
    input.requestedByUserId !== undefined
      ? input.requestedByUserId
      : openShift
        ? String(openShift.userId)
        : null;

  const { token, prefix, hash } = generateOverrideGrant();
  const expiresAt = Date.now() + OVERRIDE_GRANT_TTL_MS;

  const override = await adapter.createRegisterOverride({
    registerId: input.registerId,
    shiftId: openShift ? String(openShift.id) : null,
    approverUserId: String(approver.id),
    requestedByUserId,
    action: input.action,
    grantPrefix: prefix,
    grantHash: hash,
    expiresAt,
    reason: input.reason ?? null,
  });

  return { token, expiresAt, override, approver };
}

export interface ConsumeOverrideInput {
  token: string;
  /** Must match the grant's own action, or the consume is refused as `action_mismatch`. */
  action: OverrideAction;
  /** Must match the grant's own register, or the consume is refused as `register_mismatch`. */
  registerId: string;
  entity?: string;
  entityId?: string;
  beforeValue?: string | number | null;
  afterValue?: string | number | null;
}

export type ConsumeOverrideResult =
  | { override: DbRow }
  | 'unknown'
  | 'spent'
  | 'expired'
  | 'action_mismatch'
  | 'register_mismatch';

/**
 * Spend a manager-override grant, exactly once.
 *
 * Prefix lookup then a bcrypt compare against every row sharing that prefix —
 * same shape as `registerEnrolment.redeemPairingCode` — followed by checks in
 * a fixed order: unknown grant, already spent, expired, wrong action, wrong
 * register. Each returns a distinct result so the caller (a route) can tell
 * "no such grant" apart from "a real grant, just not for this."
 *
 * `registerId` is checked here even though it is not part of the grant's
 * identity in the strictest sense (the token alone identifies the row): a
 * grant minted at one till must never authorise an action at another, and
 * checking it BEFORE marking the row consumed means a misdirected attempt
 * costs nothing — the grant is still good at the register it was actually
 * issued for.
 *
 * On success, the row is updated atomically (guarded on `consumed_at IS
 * NULL`, the same race-safety `redeemPairingCredential` uses) with what was
 * actually done — `entity`/`entityId`/`before_value`/`after_value` — so the
 * one row that granted permission also becomes the record of what the
 * permission was used for, not just what it would have allowed.
 */
export async function consumeOverride(
  adapter: DatabaseAdapter,
  input: ConsumeOverrideInput
): Promise<ConsumeOverrideResult> {
  const prefix = input.token.split('_').slice(0, 2).join('_');
  const candidates = await adapter.getRegisterOverridesByPrefix(prefix);

  let matched: DbRow | null = null;
  for (const candidate of candidates) {
    const isMatch = await bcrypt.compare(input.token, String(candidate.grantHash));
    if (isMatch) matched = candidate;
  }

  if (!matched) {
    // Timing-safe miss path: a prefix naming no row still pays the cost of a
    // real bcrypt compare, so response timing cannot distinguish "no such
    // grant" from "a real grant whose hash didn't match".
    await bcrypt.compare(input.token, DUMMY_GRANT_HASH);
    return 'unknown';
  }

  if (matched.consumedAt != null) return 'spent';
  if (Number(matched.expiresAt) <= Date.now()) return 'expired';
  if (matched.action !== input.action) return 'action_mismatch';
  if (String(matched.registerId) !== input.registerId) return 'register_mismatch';

  const consumed = await adapter.consumeRegisterOverride(String(matched.id), {
    entity: input.entity ?? null,
    entityId: input.entityId ?? null,
    beforeValue: input.beforeValue == null ? null : String(input.beforeValue),
    afterValue: input.afterValue == null ? null : String(input.afterValue),
  });
  // Lost a race with a concurrent consume of the same grant between the read
  // above and this guarded write — the same shape as `spent`, just caught a
  // moment later.
  if (!consumed) return 'spent';

  return { override: consumed };
}

/** A human-readable reason for a failed {@link consumeOverride}, for the message half of an error envelope. */
export function describeOverrideFailure(
  result: Exclude<ConsumeOverrideResult, { override: DbRow }>
): string {
  switch (result) {
    case 'unknown':
      return 'That override grant is not valid';
    case 'spent':
      return 'That override grant has already been used';
    case 'expired':
      return 'That override grant has expired';
    case 'action_mismatch':
      return 'That override grant was not issued for this action';
    case 'register_mismatch':
      return 'That override grant was not issued for this register';
  }
}
