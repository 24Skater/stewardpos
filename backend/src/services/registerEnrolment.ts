import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { DbRow } from '../adapters/db/types';
import type { DatabaseAdapter } from './database';

/**
 * Device enrolment: turning a register from a name any browser can claim
 * (`X-Register-Id`, Phase 2) into a physical device with a real credential
 * that can be destroyed.
 *
 * A pairing code is short-lived, single-use, and typed by a human from one
 * screen into another — an operator standing at the till reads it off the
 * admin console and enters it on the device. Redeeming it mints a device
 * token, the credential the till actually authenticates with from then on.
 * Both follow the `generateApiKey` pattern in `api/routes/apikeys.ts`: a
 * plainly-stored prefix for lookup, a bcrypt hash for verification, and the
 * secret returned to the caller exactly once.
 *
 * Every function here returns a discriminated result rather than throwing
 * for an expected failure (unknown code, expired, already used, register
 * retired) — see `services/registers.ts` for the same house style. Routes
 * map each outcome to a status code; nothing here knows about HTTP.
 */

/**
 * Excludes 0/O, 1/I/L: a pairing code is read off one screen and typed into
 * another, and those pairs are the ones that are genuinely ambiguous in most
 * on-screen fonts. 31 characters (8 digits + 23 letters) at 8 characters
 * gives 31^8 ≈ 8.5 * 10^11 possible codes — combined with a 15-minute expiry,
 * single use, and the rate limit in front of `/pair`, brute-forcing one is
 * not practical.
 */
const PAIRING_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_GROUP_SIZE = 4;
const PAIRING_CODE_TTL_MS = 15 * 60 * 1000;

const BCRYPT_ROUNDS = 10;

/**
 * A bcrypt hash of a value nothing will ever match, computed once at module
 * load rather than per call — hashing is the expensive half of bcrypt, and
 * this constant is compared against on every miss, not created fresh.
 *
 * Used so a request naming an unknown prefix takes the same time as one
 * naming a real prefix whose hash simply doesn't match — `bcrypt.compare`
 * runs unconditionally either way. Without it, "no row with that prefix"
 * would return in microseconds while "wrong code for a real prefix" would
 * take bcrypt's ~100ms, and that timing gap is exactly the side channel that
 * lets an attacker enumerate which prefixes exist.
 */
const DUMMY_HASH = bcrypt.hashSync('no-such-credential', BCRYPT_ROUNDS);

/** A code as the operator types it back: strip separators/whitespace, uppercase. */
export function normalizePairingCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

function randomAlphabetChar(): string {
  return PAIRING_CODE_ALPHABET[crypto.randomInt(PAIRING_CODE_ALPHABET.length)];
}

/** An 8-character pairing code drawn from the unambiguous alphabet above. */
export function generatePairingCode(): string {
  return Array.from({ length: PAIRING_CODE_LENGTH }, randomAlphabetChar).join('');
}

/** 'ABCD-2345' — two groups of four, for reading off one screen and typing into another. */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, PAIRING_CODE_GROUP_SIZE)}-${code.slice(PAIRING_CODE_GROUP_SIZE)}`;
}

interface GeneratedToken {
  token: string;
  prefix: string;
  hash: string;
}

/** `srt_<8 hex>_<64 hex>` — same shape as `generateApiKey` in apikeys.ts, a different prefix. */
function generateDeviceToken(): GeneratedToken {
  const prefix = 'srt_' + crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  const token = `${prefix}_${secret}`;
  const hash = bcrypt.hashSync(token, BCRYPT_ROUNDS);
  return { token, prefix, hash };
}

export type IssuePairingCodeResult =
  | { code: string; formattedCode: string; expiresAt: number; registerId: string }
  | 'not_found'
  | 'retired';

/**
 * Issue a fresh pairing code for a register, revoking any prior live
 * credential first.
 *
 * That revocation is deliberate, not defensive: the partial unique index
 * (migration 017) permits only one live credential per register, so a
 * second `createPairingCredential` would collide otherwise — and revoking on
 * purpose is exactly the right behavior for both cases this hits. A lost,
 * never-redeemed code should be replaceable. And re-pairing an already
 * enrolled, active register should immediately invalidate its old device
 * token — a register mid re-pair is not authenticated by anything until the
 * new code is redeemed, so it drops back to `pending`.
 */
export async function issuePairingCode(
  adapter: DatabaseAdapter,
  registerId: string,
  userId: string | null
): Promise<IssuePairingCodeResult> {
  const register = await adapter.getRegisterById(registerId);
  if (!register) return 'not_found';
  if (register.status === 'retired') return 'retired';

  const live = await adapter.getLiveRegisterCredential(registerId);
  if (live) {
    await adapter.revokeRegisterCredentialById(String(live.id), {
      revokedBy: userId,
      reason: 'superseded_by_new_pairing_code',
    });
  }

  const code = generatePairingCode();
  const hash = await bcrypt.hash(code, BCRYPT_ROUNDS);
  const expiresAt = Date.now() + PAIRING_CODE_TTL_MS;

  await adapter.createPairingCredential({
    registerId,
    pairingCodePrefix: code.slice(0, PAIRING_CODE_GROUP_SIZE),
    pairingCodeHash: hash,
    pairingExpiresAt: expiresAt,
    createdBy: userId,
  });

  // Losing its only live credential above means an already-active register
  // can no longer authenticate as anything until the new code is redeemed.
  if (register.status === 'active') {
    await adapter.setRegisterStatus(registerId, 'pending');
  }

  return { code, formattedCode: formatPairingCode(code), expiresAt, registerId };
}

export type RedeemPairingCodeResult =
  | { token: string; register: DbRow }
  | 'unknown'
  | 'expired'
  | 'already_redeemed'
  | 'retired';

/**
 * Redeem a pairing code for a device token.
 *
 * Every row sharing the code's 4-character prefix is fetched and
 * `bcrypt.compare`d — not just the first match — so the number of codes
 * that happen to share a prefix can never leak through response timing, and
 * so a prefix collision (astronomically unlikely at 31^4 combinations, but
 * not impossible) still resolves to the one row whose full hash actually
 * matches. When nothing matches, a dummy comparison still runs, so an
 * unknown prefix takes the same time as a wrong code for a real one.
 */
export async function redeemPairingCode(
  adapter: DatabaseAdapter,
  rawCode: string
): Promise<RedeemPairingCodeResult> {
  const code = normalizePairingCode(rawCode);
  const prefix = code.slice(0, PAIRING_CODE_GROUP_SIZE);
  const candidates =
    code.length === PAIRING_CODE_LENGTH ? await adapter.getPairingCredentialsByPrefix(prefix) : [];

  let matched: DbRow | null = null;
  for (const candidate of candidates) {
    const isMatch = await bcrypt.compare(code, String(candidate.pairingCodeHash));
    if (isMatch) matched = candidate;
  }

  if (!matched) {
    await bcrypt.compare(code, DUMMY_HASH);
    return 'unknown';
  }

  // A revoked pairing code — superseded by a fresher one, or the register it
  // named was revoked outright — is gone, not merely stale. Folding it into
  // 'unknown' rather than a distinct outcome avoids telling an
  // unauthenticated caller that a code they typed once existed.
  if (matched.revokedAt != null) return 'unknown';
  if (matched.enrolledAt != null) return 'already_redeemed';
  if (Number(matched.pairingExpiresAt) <= Date.now()) return 'expired';

  const register = await adapter.getRegisterById(String(matched.registerId));
  if (!register) return 'unknown';
  if (register.status === 'retired') return 'retired';

  const { token, prefix: tokenPrefix, hash: tokenHash } = generateDeviceToken();

  // Guarded at the adapter on `enrolled_at IS NULL AND revoked_at IS NULL`:
  // two concurrent redemption attempts for the same code can only ever mint
  // one token. The loser reads back as null here.
  const redeemed = await adapter.redeemPairingCredential(String(matched.id), {
    tokenPrefix,
    tokenHash,
    enrolledAt: Date.now(),
  });
  if (!redeemed) return 'already_redeemed';

  const activated = await adapter.setRegisterStatus(String(register.id), 'active');

  return { token, register: activated ?? register };
}

export type VerifyDeviceTokenResult = { register: DbRow; credentialId: string } | 'invalid' | 'revoked';

/**
 * Verify a device token, the credential minted at pairing.
 *
 * Same shape as {@link redeemPairingCode}'s prefix lookup: every row sharing
 * the token's prefix is compared, and a miss still runs a dummy compare, for
 * the same timing-safety reason.
 */
export async function verifyDeviceToken(
  adapter: DatabaseAdapter,
  rawToken: string
): Promise<VerifyDeviceTokenResult> {
  const prefix = rawToken.split('_').slice(0, 2).join('_');
  const candidates = await adapter.getRegisterCredentialsByTokenPrefix(prefix);

  let matched: DbRow | null = null;
  for (const candidate of candidates) {
    if (!candidate.tokenHash) continue;
    const isMatch = await bcrypt.compare(rawToken, String(candidate.tokenHash));
    if (isMatch) matched = candidate;
  }

  if (!matched) {
    await bcrypt.compare(rawToken, DUMMY_HASH);
    return 'invalid';
  }

  if (matched.revokedAt != null) return 'revoked';

  const register = await adapter.getRegisterById(String(matched.registerId));
  if (!register) return 'invalid';

  // Best-effort: a failure to stamp last-used must not fail the request that
  // is, itself, evidence the credential works.
  await adapter.touchRegisterCredentialLastUsed(String(matched.id));

  return { register, credentialId: String(matched.id) };
}

export type RevokeCredentialResult = { register: DbRow; credential: DbRow | null } | 'not_found';

/**
 * Revoke a register's live credential, if it has one, and return the
 * register to `pending`.
 *
 * Always sets the register back to `pending`, even when there was no live
 * credential to revoke (a register enrolled, then revoked, then revoked
 * again) — `pending` is simply the correct state for "cannot currently
 * authenticate as a device," and this must not leave a register claiming
 * `active` with nothing behind it.
 */
export async function revokeCredential(
  adapter: DatabaseAdapter,
  registerId: string,
  opts: { userId?: string | null; reason?: string | null }
): Promise<RevokeCredentialResult> {
  const register = await adapter.getRegisterById(registerId);
  if (!register) return 'not_found';

  const live = await adapter.getLiveRegisterCredential(registerId);
  let credential: DbRow | null = null;
  if (live) {
    credential = await adapter.revokeRegisterCredentialById(String(live.id), {
      revokedBy: opts.userId ?? null,
      reason: opts.reason ?? null,
    });
  }

  const updated = await adapter.setRegisterStatus(registerId, 'pending');

  return { register: updated ?? register, credential };
}
