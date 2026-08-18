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

/** Checkout refused because the register requires a cashier sign-in and none is open. */
export const SHIFT_REQUIRED = 'SHIFT_REQUIRED';
