/**
 * Stable error codes for register-device authentication.
 *
 * A terminal has to tell two 401s apart: its *device credential* was revoked
 * (clear the stored token, go to the pairing screen) versus the *user's*
 * session expired (go to the login screen). Those need different recoveries,
 * and before this existed the frontend told them apart by regex-matching the
 * error prose — so rewording a message would have silently stranded a revoked
 * till in a retry loop, which is the failure enrolment exists to prevent.
 *
 * Kept in its own module so both the middleware that throws it and any route
 * that needs it can import it without pulling in Express plumbing. The literal
 * value is part of the API contract with the client: do not change it.
 */
export const REGISTER_TOKEN_INVALID = 'REGISTER_TOKEN_INVALID';

/**
 * A PIN was entered at `POST /:id/shifts` and did not match any active
 * cashier's PIN in the organization. Distinguished from {@link PIN_LOCKED} so
 * the till can tell "wrong PIN, try again" apart from "stop asking, this
 * account is locked out" — the recoveries differ (retry vs. wait / find a
 * manager).
 */
export const PIN_INVALID = 'PIN_INVALID';

/**
 * The PIN entered matches an account whose PIN is currently locked out after
 * repeated failures (see `services/pins.ts`). Never sent for a PIN that
 * simply does not match anyone — that is {@link PIN_INVALID}.
 */
export const PIN_LOCKED = 'PIN_LOCKED';

/**
 * A register with `require_sign_in` was asked to ring a sale or a return
 * with no open shift on it. The client's recovery is to prompt for a PIN and
 * retry, not to treat this like an ordinary validation failure.
 */
export const SHIFT_REQUIRED = 'SHIFT_REQUIRED';
