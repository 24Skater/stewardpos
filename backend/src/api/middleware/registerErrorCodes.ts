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
