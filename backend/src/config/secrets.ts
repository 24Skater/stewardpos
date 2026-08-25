/**
 * Refusing to start with the secrets this repository ships.
 *
 * `JWT_SECRET` is already checked for length, which catches an unset one — and
 * lets `CHANGE_THIS_MIN_32_CHARACTERS_SECRET` straight through, because it is
 * thirty-six characters long. Every compose file in the repo carries that value
 * as its default, along with `stewardpos_secure_password_123` for the database
 * and `CHANGE_THIS_PASSWORD` for MinIO, and they are readable by anyone who can
 * read this repository.
 *
 * A shop that follows the install guide sets real ones. A shop that skips a step
 * gets an install whose session-signing key and database password are published
 * on the internet, and nothing tells it so. This is the thing that tells it.
 *
 * **Production only.** A developer running `docker compose up` should not have
 * to invent secrets to see the app work; the danger is a live install, and the
 * check is scoped to it.
 */

/**
 * The values this repository ships, lower-cased for comparison.
 *
 * Matched exactly rather than by pattern: a store is entitled to choose a
 * passphrase containing the word "change", and refusing to boot over that would
 * be a worse failure than the one being prevented.
 */
const SHIPPED_PLACEHOLDERS: readonly string[] = [
  'change_this_min_32_characters_secret',
  'change_this_password',
  'change_this',
  'changeme',
  'stewardpos_secure_password_123',
  'dev_password_change_me',
  'minioadmin',
  'minioadmin123',
  'postgres',
  'password',
  'secret',
  'your-secret-key',
  'your-super-secret-jwt-key',
  'test-secret-min-32-characters-long-for-ci',
];

export interface SecretToCheck {
  /** The environment variable an operator would set, for the error message. */
  name: string;
  value: string | undefined;
  /** Optional minimum length, checked only when a value is present. */
  minLength?: number;
}

/**
 * Everything wrong with the secrets, rather than the first thing.
 *
 * Reported together so an operator fixes one `.env` and restarts once, instead
 * of discovering the next placeholder on the next boot.
 */
export function findWeakSecrets(secrets: readonly SecretToCheck[]): string[] {
  const problems: string[] = [];

  for (const { name, value, minLength } of secrets) {
    if (!value) {
      problems.push(`${name} is not set`);
      continue;
    }

    if (SHIPPED_PLACEHOLDERS.includes(value.trim().toLowerCase())) {
      problems.push(
        `${name} is the placeholder this repository ships, which is public. ` +
          `Generate one with: openssl rand -base64 32`
      );
      continue;
    }

    if (minLength !== undefined && value.length < minLength) {
      problems.push(`${name} must be at least ${minLength} characters`);
    }
  }

  return problems;
}

/**
 * The secrets a production install must have set for itself.
 *
 * Each is conditional on actually being in use: a SQLite install has no
 * database password, and an install storing uploads on a volume has no bucket
 * credential. Demanding a strong value for something the install does not use
 * teaches people to put a placeholder there, which is worse than not asking.
 */
export function productionSecrets(env: NodeJS.ProcessEnv): SecretToCheck[] {
  const secrets: SecretToCheck[] = [
    { name: 'JWT_SECRET', value: env.JWT_SECRET, minLength: 32 },
  ];

  // Only when Postgres is actually in use; a SQLite install has no password.
  if ((env.DB_ADAPTER ?? 'postgres') === 'postgres') {
    secrets.push({ name: 'DB_PASSWORD', value: env.DB_PASSWORD, minLength: 12 });
  }

  /**
   * The bucket credential, keyed off the adapter rather than off whether a
   * variable happens to be present.
   *
   * This checked `MINIO_SECRET_KEY` — a variable the app never read for any
   * other purpose, and which said nothing about whether object storage was in
   * use, because no code path could reach a bucket at all. Now that
   * `STORAGE_ADAPTER=s3` means something, the question to ask is whether the
   * install has selected it.
   */
  if (env.STORAGE_ADAPTER === 's3') {
    secrets.push({
      name: 'S3_SECRET_ACCESS_KEY',
      value: env.S3_SECRET_ACCESS_KEY,
      minLength: 12,
    });
  }

  return secrets;
}

/**
 * Throw unless a production install has real secrets.
 *
 * Throws rather than exiting so it is testable and so the caller decides how a
 * failure is reported; `config/index.ts` turns it into the same startup message
 * every other configuration failure produces.
 */
export function assertProductionSecrets(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'production') return;

  const problems = findWeakSecrets(productionSecrets(env));
  if (problems.length === 0) return;

  throw new Error(
    `Refusing to start in production with insecure secrets:\n` +
      problems.map((problem) => `  - ${problem}`).join('\n') +
      `\n\nSee docs/guides/install-vps.md.`
  );
}
