import { z } from 'zod';

/**
 * What counts as an acceptable password, in one place.
 *
 * It was two places and two answers: `POST /api/admin/users` accepted six
 * characters, `POST /api/setup` demanded eight, and neither looked at what the
 * characters were. Six is not a policy - `abc123` passes it - and having the
 * weaker rule on the endpoint that creates *additional* admins is the wrong way
 * round.
 *
 * Passwords here are also the credential with the least protection around it.
 * A cashier's PIN gets locked out after five wrong guesses (`services/pins.ts`)
 * because six digits is trivially guessable; a password gets IP rate limiting
 * and, until this, no minimum worth the name.
 *
 * ## Why length and not composition
 *
 * No "one uppercase, one digit, one symbol" rule. Those requirements are what
 * produce `Password1!` - they narrow the search space far more than they widen
 * it, because everyone satisfies them the same way. NIST SP 800-63B stopped
 * recommending them for exactly that reason and recommends length plus a check
 * against known-bad values instead, which is what this is.
 *
 * ## Why raising it is safe on an existing install
 *
 * This validates a password being *set*, never one being verified. Every
 * existing account keeps working with whatever it has; the rule applies the
 * next time someone chooses one. Nobody is locked out by this change.
 */

/**
 * Twelve, not eight.
 *
 * Eight characters of anything a person will actually remember is inside reach
 * of offline cracking against a bcrypt hash, and the threat model here includes
 * the database leaking - which is the scenario every other decision in this
 * area (bcrypt cost, `CREDENTIALS_KEY`) is written for. Twelve is the common
 * modern floor and is not onerous for a back-office account that a browser's
 * password manager will fill.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Bcrypt ignores everything past the 72nd byte.
 *
 * Not a limit we are choosing - it is the algorithm's. Left unsaid, a person
 * using a long passphrase would have it silently truncated, and two different
 * passphrases sharing a 72-byte prefix would both open the account. Refusing
 * with an explanation is better than accepting and quietly meaning something
 * else.
 *
 * Measured in *bytes*, not characters: an emoji is four, and a password of
 * twenty emoji would sail past a character count and still be truncated.
 */
export const MAX_PASSWORD_BYTES = 72;

/**
 * Values that must never be a password here, lower-cased.
 *
 * Deliberately short and specific to this application rather than a general
 * top-10k list. A real breach-corpus check is the right long-term answer and
 * needs a data file and a lookup; this catches the ones that actually show up
 * on a hurried install - the credentials this repository itself publishes, and
 * the handful of words someone types when a form demands twelve characters.
 *
 * Compared after the length check, so most of these never reach it anyway.
 * They are here because a twelve-character bad password is still a bad
 * password.
 */
const FORBIDDEN: readonly string[] = [
  'demopass!1',
  'password',
  'password123',
  'password1234',
  'passw0rd',
  'administrator',
  'stewardpos',
  'stewardpos123',
  'changeme',
  'change_this',
  'change_this_password',
  'letmein',
  'qwertyuiop',
  '123456789012',
  'iloveyou',
];

/** Runs of the same character, or a straight alphanumeric run. */
function isTrivialSequence(value: string): boolean {
  const lowered = value.toLowerCase();

  // `aaaaaaaaaaaa`
  if (/^(.)\1+$/.test(lowered)) return true;

  // `abcdefghijkl` / `123456789012` in either direction. Built rather than
  // listed so the check does not depend on guessing where someone starts.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '01234567890123456789';
  for (const run of [alphabet, [...alphabet].reverse().join(''), digits]) {
    if (run.includes(lowered)) return true;
  }

  return false;
}

/**
 * Everything wrong with a password, rather than the first thing.
 *
 * Reported together so somebody choosing one fixes it in a single attempt
 * instead of discovering the next rule on the next try - the same reasoning as
 * `findWeakSecrets` in `config/secrets.ts`.
 *
 * `context` is the account's own identifying strings (name, email). A password
 * derived from the address it protects is guessable by anyone who can see the
 * address, which for a staff account is anyone who has been emailed by them.
 */
export function findPasswordProblems(
  password: string,
  context: { email?: string; name?: string } = {}
): string[] {
  const problems: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    problems.push(
      `Password must be at most ${MAX_PASSWORD_BYTES} bytes; everything beyond that is ignored`
    );
  }

  const lowered = password.trim().toLowerCase();

  if (FORBIDDEN.includes(lowered)) {
    problems.push('That password is too common to use');
  }

  if (password.length >= MIN_PASSWORD_LENGTH && isTrivialSequence(password)) {
    problems.push('That password is a single repeated character or a straight sequence');
  }

  // The local part, not the whole address: `ada@shop.example` choosing
  // `ada@shop.example` is caught by this too, since it contains `ada`.
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && lowered.includes(local)) {
    problems.push('Password must not contain your email address');
  }

  const name = context.name?.trim().toLowerCase();
  if (name && name.length >= 3 && lowered.includes(name)) {
    problems.push('Password must not contain your name');
  }

  return problems;
}

/**
 * The zod schema for a password field.
 *
 * Context-free, so it enforces only the rules that need no account: length and
 * the forbidden list. A route that knows the email and name should call
 * `findPasswordProblems` as well - see `api/routes/admin.ts`.
 */
export const passwordSchema = z
  .string()
  .superRefine((value, ctx) => {
    for (const message of findPasswordProblems(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  });
