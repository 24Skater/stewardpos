/**
 * The server's password rule, restated for the setup wizard.
 *
 * A deliberate duplicate of `backend/src/services/passwordPolicy.ts`, and the
 * duplication is the point worth being explicit about: the server is the only
 * thing that *enforces* this, because a browser check is advice to a
 * cooperating user and nothing more. This copy exists so the wizard can say
 * "twelve characters" while someone is typing, instead of letting them fill in
 * the whole form and rejecting the submission afterwards.
 *
 * Kept deliberately small — length, the obvious-value list, and the checks that
 * need the account's own name and address. `src/lib/__tests__/password-policy.test.ts`
 * asserts the two files agree on the numbers, so they cannot drift silently.
 */

export const MIN_PASSWORD_LENGTH = 12;

/** Bcrypt ignores everything past the 72nd byte; see the server's note. */
export const MAX_PASSWORD_BYTES = 72;

const FORBIDDEN = new Set([
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
]);

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isTrivialSequence(value: string): boolean {
  const lowered = value.toLowerCase();
  if (/^(.)\1+$/.test(lowered)) return true;

  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '01234567890123456789';
  const runs = [alphabet, [...alphabet].reverse().join(''), digits];
  return runs.some((run) => run.includes(lowered));
}

/**
 * The first thing wrong with `password`, or null when it is acceptable.
 *
 * Returns one message rather than all of them because the caller is a toast,
 * which has room for a sentence.
 */
export function describePasswordProblem(
  password: string,
  context: { email?: string; name?: string } = {}
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }

  if (byteLength(password) > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} bytes; everything beyond that is ignored`;
  }

  const lowered = password.trim().toLowerCase();

  if (FORBIDDEN.has(lowered)) {
    return 'That password is too common to use';
  }

  if (isTrivialSequence(password)) {
    return 'That password is a single repeated character or a straight sequence';
  }

  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && lowered.includes(local)) {
    return 'Password must not contain your email address';
  }

  const name = context.name?.trim().toLowerCase();
  if (name && name.length >= 3 && lowered.includes(name)) {
    return 'Password must not contain your name';
  }

  return null;
}
