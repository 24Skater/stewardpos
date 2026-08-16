import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * When the seeder is allowed to run.
 *
 * It writes an administrator called `admin@demo.local` whose password is printed
 * in this repository, plus a demo catalog. `AUTO_SEED` lives in a `.env` file
 * one line away from the settings an operator is already editing, so "a shop
 * turns it on by mistake" is not a hypothetical — and the result would be a
 * live install carrying a working account with published credentials. That is
 * the same defect as the "Reset Data" button this phase documents, arriving by
 * a different route.
 *
 * The database is mocked away entirely: what is under test is the decision to
 * seed, not the SQL, which the provisioning integration test covers against a
 * real Postgres.
 */
const query = vi.fn();

vi.mock('pg', () => ({
  Pool: class {
    query = query;
    end = vi.fn();
  },
}));

vi.mock('better-sqlite3', () => ({ default: class {} }));

const { default: config } = await import('../../config');
const { Seeder } = await import('../seeder');

const originalEnv = config.nodeEnv;

/** A seeder whose every write is observable and whose reads are ours. */
function seeder(users: number) {
  query.mockImplementation(async (sql: string) => {
    if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ count: String(users) }] };
    // Every other statement answers with a row carrying an id: the seeder reads
    // one back from its `RETURNING` clauses, and an empty result would fail on
    // the shape rather than on the decision this file is about.
    return { rows: [{ id: 'seeded' }] };
  });
  return new Seeder();
}

/** Did anything other than the emptiness check run? */
function wrote(): boolean {
  return query.mock.calls.some(([sql]) => !/COUNT\(\*\)/i.test(String(sql)));
}

beforeEach(() => {
  vi.clearAllMocks();
  config.nodeEnv = 'development';
  config.database.adapter = 'postgres';
});

afterEach(() => {
  config.nodeEnv = originalEnv;
});

describe('Seeder.seed', () => {
  it('seeds a database that has never been used', async () => {
    await seeder(0).seed();

    expect(wrote()).toBe(true);
  });

  it('declines a database that already has users', async () => {
    // "Empty" means no users rather than no rows anywhere: a database that has
    // been through the setup wizard has an administrator but may have no
    // products, and seeding a demo catalog over a real install is the mild
    // version of this mistake.
    await seeder(3).seed();

    expect(wrote()).toBe(false);
  });

  it('seeds a populated database when forced', async () => {
    // The demo profile and "Reset Demo Data" both mean it.
    await seeder(3).seed(true);

    expect(wrote()).toBe(true);
  });

  it('refuses production outright', async () => {
    config.nodeEnv = 'production';

    await seeder(0).seed();

    expect(wrote()).toBe(false);
  });

  it('refuses production even when forced', async () => {
    // `force` bypasses the emptiness check only. There is no caller for which
    // planting a publicly-known administrator on a live install is right, and a
    // demo-mode tick in the setup wizard is exactly how one would arrive.
    config.nodeEnv = 'production';

    await seeder(0).seed(true);

    expect(wrote()).toBe(false);
  });

  it('does not even look at the database in production', async () => {
    config.nodeEnv = 'production';

    await seeder(0).seed(true);

    expect(query).not.toHaveBeenCalled();
  });
});
