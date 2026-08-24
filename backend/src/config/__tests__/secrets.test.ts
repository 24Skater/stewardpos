import { describe, it, expect } from 'vitest';
import {
  assertProductionSecrets,
  findWeakSecrets,
  productionSecrets,
} from '../secrets';

/**
 * Refusing to boot a production install on the secrets this repository ships.
 *
 * The existing check is `z.string().min(32)` on `JWT_SECRET`, which catches an
 * unset one and waves `CHANGE_THIS_MIN_32_CHARACTERS_SECRET` through — it is
 * thirty-six characters long, and it is the default in every compose file here.
 * An install that skipped a step would sign its sessions with a key published
 * on the internet, and nothing would say so.
 */
describe('findWeakSecrets', () => {
  it('accepts a real secret', () => {
    expect(
      findWeakSecrets([{ name: 'JWT_SECRET', value: 'Yy8sV0Qk3mR7pL2wZ1xN4bT6hJ9cD5fA', minLength: 32 }])
    ).toEqual([]);
  });

  it('rejects the placeholder that passes the length check', () => {
    const problems = findWeakSecrets([
      { name: 'JWT_SECRET', value: 'CHANGE_THIS_MIN_32_CHARACTERS_SECRET', minLength: 32 },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/placeholder/);
    // The message says what to do about it, not merely that it is wrong.
    expect(problems[0]).toMatch(/openssl rand/);
  });

  it('rejects the shipped database and bucket passwords', () => {
    const problems = findWeakSecrets([
      { name: 'DB_PASSWORD', value: 'stewardpos_secure_password_123' },
      { name: 'S3_SECRET_ACCESS_KEY', value: 'CHANGE_THIS_PASSWORD' },
    ]);

    expect(problems).toHaveLength(2);
  });

  it('ignores case and surrounding whitespace', () => {
    // A value pasted out of a compose file can arrive padded.
    expect(findWeakSecrets([{ name: 'DB_PASSWORD', value: '  MinioAdmin  ' }])).toHaveLength(1);
  });

  it('reports an unset secret as unset rather than as a placeholder', () => {
    expect(findWeakSecrets([{ name: 'JWT_SECRET', value: undefined }])).toEqual([
      'JWT_SECRET is not set',
    ]);
  });

  it('does not refuse a passphrase that merely contains a banned word', () => {
    // Matched exactly, not by pattern. A store is entitled to a passphrase like
    // this, and refusing to boot over it would be a worse failure than the one
    // being prevented.
    expect(
      findWeakSecrets([
        { name: 'JWT_SECRET', value: 'change_this_is_my_actual_long_passphrase_2026', minLength: 32 },
      ])
    ).toEqual([]);
  });

  it('reports every problem at once', () => {
    // So an operator edits one `.env` and restarts once, rather than finding the
    // next placeholder on the next boot.
    const problems = findWeakSecrets([
      { name: 'JWT_SECRET', value: 'CHANGE_THIS_MIN_32_CHARACTERS_SECRET', minLength: 32 },
      { name: 'DB_PASSWORD', value: 'postgres' },
      { name: 'S3_SECRET_ACCESS_KEY', value: undefined },
    ]);

    expect(problems).toHaveLength(3);
  });

  it('enforces a minimum length on a value that is real but short', () => {
    expect(findWeakSecrets([{ name: 'JWT_SECRET', value: 'aB3xQ', minLength: 32 }])).toEqual([
      'JWT_SECRET must be at least 32 characters',
    ]);
  });
});

describe('productionSecrets', () => {
  it('always requires a signing key', () => {
    const names = productionSecrets({ DB_ADAPTER: 'sqlite' } as NodeJS.ProcessEnv).map((s) => s.name);

    expect(names).toContain('JWT_SECRET');
  });

  it('requires a database password only when Postgres is in use', () => {
    const postgres = productionSecrets({} as NodeJS.ProcessEnv).map((s) => s.name);
    const sqlite = productionSecrets({ DB_ADAPTER: 'sqlite' } as NodeJS.ProcessEnv).map((s) => s.name);

    // Postgres is the default when unset, so an omitted adapter still counts.
    expect(postgres).toContain('DB_PASSWORD');
    expect(sqlite).not.toContain('DB_PASSWORD');
  });

  it('checks the bucket key only when the s3 adapter is selected', () => {
    // Object storage is optional — the default adapter writes to a volume — so
    // an install that never selected it has no bucket secret to be weak. Keyed
    // off STORAGE_ADAPTER rather than off a variable being present: the old
    // check watched MINIO_SECRET_KEY, which the app read for nothing else and
    // which said nothing about whether a bucket was actually in use.
    const local = productionSecrets({} as NodeJS.ProcessEnv).map((s) => s.name);
    const s3 = productionSecrets({ STORAGE_ADAPTER: 's3' } as NodeJS.ProcessEnv).map((s) => s.name);

    expect(local).not.toContain('S3_SECRET_ACCESS_KEY');
    expect(s3).toContain('S3_SECRET_ACCESS_KEY');
  });

  it('demands the bucket key even when it is simply absent', () => {
    // The failure mode worth naming: STORAGE_ADAPTER=s3 with no credential at
    // all should stop the boot, not start and fail on the first upload.
    const problems = findWeakSecrets(
      productionSecrets({ STORAGE_ADAPTER: 's3' } as NodeJS.ProcessEnv)
    );

    expect(problems).toContain('S3_SECRET_ACCESS_KEY is not set');
  });
});

describe('assertProductionSecrets', () => {
  const STRONG = {
    JWT_SECRET: 'Yy8sV0Qk3mR7pL2wZ1xN4bT6hJ9cD5fA',
    DB_PASSWORD: 'a-real-database-password',
  };

  it('says nothing outside production', () => {
    // A developer running `docker compose up` should not have to invent secrets
    // to see the app work; the danger being addressed is a live install.
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'development',
        JWT_SECRET: 'CHANGE_THIS_MIN_32_CHARACTERS_SECRET',
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });

  it('passes a production install with real secrets', () => {
    expect(() =>
      assertProductionSecrets({ NODE_ENV: 'production', ...STRONG } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });

  it('refuses a production install on the shipped signing key', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        ...STRONG,
        JWT_SECRET: 'CHANGE_THIS_MIN_32_CHARACTERS_SECRET',
      } as NodeJS.ProcessEnv)
    ).toThrow(/JWT_SECRET/);
  });

  it('refuses a production install on the shipped database password', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        ...STRONG,
        DB_PASSWORD: 'stewardpos_secure_password_123',
      } as NodeJS.ProcessEnv)
    ).toThrow(/DB_PASSWORD/);
  });

  it('points at the install guide rather than only complaining', () => {
    expect(() =>
      assertProductionSecrets({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)
    ).toThrow(/install-vps\.md/);
  });
});
