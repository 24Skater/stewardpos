import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresAdapter } from '../PostgresAdapter';
import { DatabaseError } from '../../../utils/errors';
import logger from '../../../utils/logger';

/**
 * Every adapter method, against a database that fails every query.
 *
 * The contract the routes rely on: a driver failure comes out as a
 * `DatabaseError` — which the error handler turns into a 500 with a generic
 * message — never as the raw `pg` error (whose text names tables and columns),
 * and never as a quiet success. A method that swallows the failure and returns
 * a default reports "nothing found" or "zero uses" to its caller when the
 * truth is "we could not look", which for a limit check means failing open.
 *
 * The integration suites exercise the SQL; this exercises the other half of
 * almost every method, its `catch`, which a working database never reaches.
 * Transactions get a client whose BEGIN/ROLLBACK succeed and whose real work
 * fails, which is the failure that actually matters there.
 */
const DRIVER_TEXT = 'relation "secret_internal_table" does not exist';

type AnyMethod = (...args: unknown[]) => Promise<unknown>;

/**
 * Methods that deliberately absorb a failure, each for a stated reason in its
 * doc comment: stamping "last used" must not fail the request it describes,
 * and `testConnection` exists to report false.
 */
const BEST_EFFORT = new Set([
  'testConnection',
  'updateApiKeyLastUsed',
  'touchRegisterCredentialLastUsed',
  'markWebhookEventHandled',
  'markRefundFailed',
]);

/** Absorb failures but should not — see the `it.fails` cases below. */
const KNOWN_SWALLOWS = new Set(['incrementPromoCodeUsage', 'getPromoCodeUsageByCustomer']);

/** Not database calls, or no query to fail with these arguments. */
const NOT_QUERIES = new Set(['constructor', 'close']);

const ID = '00000000-0000-0000-0000-000000000001';

let adapter: PostgresAdapter;
let released: number;
let connected: number;

function failingAdapter(): PostgresAdapter {
  const a = new PostgresAdapter({ host: 'unused', port: 1, database: 'unused_test', user: 'x', password: 'x' });
  const fail = () => Promise.reject(new Error(DRIVER_TEXT));
  const client = {
    query: (sql: unknown) =>
      /^\s*(BEGIN|ROLLBACK)/i.test(String(sql)) ? Promise.resolve({ rows: [], rowCount: 0 }) : fail(),
    release: () => {
      released++;
    },
  };
  // Replace the real pool before anything connects; the real one is never used.
  (a as unknown as { pool: unknown }).pool = {
    query: fail,
    connect: async () => {
      connected++;
      return client;
    },
    end: async () => {},
  };
  return a;
}

const asyncMethods = Object.getOwnPropertyNames(PostgresAdapter.prototype).filter((name) => {
  if (NOT_QUERIES.has(name)) return false;
  const fn = (PostgresAdapter.prototype as unknown as Record<string, unknown>)[name];
  return typeof fn === 'function' && fn.constructor.name === 'AsyncFunction';
});

const mustThrow = asyncMethods.filter((n) => !BEST_EFFORT.has(n) && !KNOWN_SWALLOWS.has(n));

/** Methods that short-circuit on an empty payload need a real one to reach their query. */
const ARGS: Record<string, unknown[]> = {
  updateTerminalTransactionByChargeId: [ID, { status: 'approved' }],
};

const call = (name: string) =>
  (adapter as unknown as Record<string, AnyMethod>)[name](...(ARGS[name] ?? [ID, {}, {}]));

beforeEach(() => {
  released = 0;
  connected = 0;
  adapter = failingAdapter();
  // The catch arms log the driver error server-side, which is correct; keep it out of test output.
  vi.spyOn(logger, 'error').mockImplementation(() => logger);
  vi.spyOn(logger, 'warn').mockImplementation(() => logger);
});

describe('a failing database', () => {
  it('finds enough methods for the sweep to mean something', () => {
    // Guards the guard: a broken filter would make every case below vacuous.
    expect(mustThrow.length).toBeGreaterThan(100);
  });

  it.each(mustThrow)('%s reports it as a DatabaseError without the driver’s text', async (name) => {
    const outcome = await call(name).then(
      (value) => ({ resolved: value }),
      (error: unknown) => ({ error })
    );

    expect(outcome, `${name} resolved despite every query failing`).toHaveProperty('error');
    const { error } = outcome as { error: Error };
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.message).not.toContain('secret_internal_table');
    // A transaction that failed must still hand its client back to the pool.
    expect(released).toBe(connected);
  });

  it.each([...BEST_EFFORT])('%s absorbs the failure by design', async (name) => {
    await expect(call(name)).resolves.not.toThrow();
  });

  it('reports a failed connectivity check as false rather than throwing', async () => {
    expect(await adapter.testConnection()).toBe(false);
  });

  // BUG: getPromoCodeUsageByCustomer returns 0 on a database error
  // (PostgresAdapter.ts, `catch { ...; return 0; }`). Its only caller is the
  // per-customer limit in POST /api/discounts/promos/validate, so when the
  // count cannot be read the limit fails OPEN and a one-per-customer code
  // validates for a customer who has already used it.
  it.fails('getPromoCodeUsageByCustomer surfaces a failure rather than reporting zero uses', async () => {
    await expect(adapter.getPromoCodeUsageByCustomer(ID, 'c1')).rejects.toBeInstanceOf(DatabaseError);
  });

  // BUG: incrementPromoCodeUsage swallows a failed UPDATE, so
  // POST /api/discounts/promos/:id/use answers 200 while current_uses never
  // moved, and a promo with maxUses can be redeemed past its cap.
  it.fails('incrementPromoCodeUsage surfaces a failed increment', async () => {
    await expect(adapter.incrementPromoCodeUsage(ID)).rejects.toBeInstanceOf(DatabaseError);
  });
});
