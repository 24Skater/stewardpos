import config from '../config';

/**
 * The bcrypt cost factor, in one place.
 *
 * It was `const BCRYPT_ROUNDS = 10` in `pins.ts`, `registerEnrolment.ts` and
 * `registerOverrides.ts` — each with a comment saying it matched the other two,
 * which is what a constant looks like just before it stops matching — and a
 * bare `10` twice more in `admin.ts`. Meanwhile `BCRYPT_ROUNDS=10` sat in
 * `env.example`, documented as if it were configurable. It was not: setting it
 * did nothing at all.
 *
 * Now it is genuinely one value, and the documented variable genuinely sets it.
 *
 * Changing it is safe on an existing install. bcrypt encodes the cost in the
 * hash itself, so every stored hash keeps verifying at whatever cost it was
 * written with; only new hashes use the new number. Raising it re-costs a
 * password the next time it is set, not retroactively.
 */
export const BCRYPT_ROUNDS = config.security.bcryptRounds;
