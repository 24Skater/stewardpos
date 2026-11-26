import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { connect, type Harness } from './harness';
import config from '../../../../config';
import { Migrator } from '../../../../services/migrator';

/**
 * The migrator's Postgres path, against the already-migrated test database.
 *
 * `migrator.test.ts` runs the SQLite chain from scratch; this is the path every
 * real deployment takes on container start — reading the version back from
 * Postgres and deciding there is nothing to do. Getting that decision wrong
 * re-runs a migration on boot and takes the container down.
 */
let h: Harness;
const original = { ...config.database };

beforeAll(async () => {
  // connect() refuses any database whose name lacks "test"; the Migrator reads
  // the same config, so this guards it too.
  h = await connect();
}, 30_000);

afterAll(async () => {
  Object.assign(config.database, original);
  await h.close();
});

describe('Migrator on Postgres', () => {
  it('reads the highest applied version from schema_migrations', async () => {
    const migrator = new Migrator();
    const { rows } = await h.query('SELECT MAX(version) AS v FROM schema_migrations');

    const version = await migrator.getCurrentVersion();
    await migrator.close();

    expect(version).toBe(Number(rows[0].v));
    expect(version).toBeGreaterThanOrEqual(26);
  });

  it('applies nothing to a database that is already current', async () => {
    const latestFile = fs
      .readdirSync(path.join(__dirname, '../../../../../migrations/postgres'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .pop()!;
    const before = await h.query('SELECT COUNT(*)::int AS n FROM schema_migrations');

    const migrator = new Migrator();
    await migrator.runMigrations();
    await migrator.close();

    const after = await h.query('SELECT COUNT(*)::int AS n FROM schema_migrations');
    expect(after.rows[0].n).toBe(before.rows[0].n);
    // Guards the no-op claim: a test DB behind the files would have been migrated above.
    const { rows } = await h.query('SELECT MAX(version) AS v FROM schema_migrations');
    expect(Number(rows[0].v)).toBe(parseInt(latestFile.split('_')[0], 10));
  });

  it('reports version 0 when the database cannot be read, rather than throwing', async () => {
    config.database.port = 1; // nothing listens here
    const migrator = new Migrator();

    try {
      expect(await migrator.getCurrentVersion()).toBe(0);
    } finally {
      await migrator.close();
      Object.assign(config.database, original);
    }
  });
});

describe('Migrator with an unrecognised adapter', () => {
  it('opens nothing, reports version 0, and skips a missing migrations directory', async () => {
    config.database.adapter = 'nonexistent' as never;
    const migrator = new Migrator();

    try {
      expect(await migrator.getCurrentVersion()).toBe(0);
      await expect(migrator.runMigrations()).resolves.toBeUndefined();
      await expect(migrator.close()).resolves.toBeUndefined();
    } finally {
      Object.assign(config.database, original);
    }
  });
});
