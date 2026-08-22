/**
 * Stable failure codes from `backend/src/api/middleware/registerErrorCodes.ts`.
 *
 * Duplicated here rather than imported — this frontend is a separate package
 * from the backend, the same reasoning `api-client.ts` documents for its own
 * copy of `REGISTER_TOKEN_INVALID`. These are part of the API contract: a
 * caller must branch on `code`, never on the message text, which a previous
 * phase got wrong (see `PairRegister.tsx`'s `classifyPairFailure` for the
 * fallback shape that mistake still requires for endpoints that don't carry a
 * code) and which this phase's backend explicitly exists to prevent
 * happening again.
 */

/** `POST /:id/shifts` — the entered PIN matched no active cashier's PIN. */
export const PIN_INVALID = 'PIN_INVALID';

/** `POST /:id/shifts` — the entered PIN matches an account currently locked out after repeated failures. */
export const PIN_LOCKED = 'PIN_LOCKED';

/**
 * `POST /api/auth/login` — the account has a till PIN and no back-office
 * business on the password form. Their password was correct; saying "invalid
 * credentials" would send them round the retype loop forever.
 */
export const USE_PIN_AT_TILL = 'USE_PIN_AT_TILL';

/** Checkout refused because the register requires a cashier sign-in and none is open. */
export const SHIFT_REQUIRED = 'SHIFT_REQUIRED';

/**
 * A privileged action (a discount past its approval threshold, a drawer
 * closing outside its variance tolerance, a void, opening the drawer with no
 * sale) was refused because no valid manager-override grant was supplied, or
 * the one supplied did not check out — missing, expired, already spent, or
 * issued for a different action or register. Carried with `data: { action }`
 * naming which of the four flows to prompt a supervisor PIN for; see
 * `OverridePrompt.tsx`.
 *
 * Deliberately one code for every one of those reasons — the backend does not
 * let a client tell "nobody tried" apart from "somebody tried and it didn't
 * work" any more finely than that. See
 * `backend/src/services/registerOverrides.ts`'s `describeOverrideFailure`.
 */
export const OVERRIDE_REQUIRED = 'OVERRIDE_REQUIRED';
