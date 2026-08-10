import { PostgresAdapter } from '../../PostgresAdapter';

/**
 * Integration-test harness: a real Postgres, real SQL, no mocks.
 *
 * The adapters were the least-covered code in the repository — roughly 7,900
 * lines of SQL at 0.17% — because every route test mocks the adapter. A mocked
 * adapter proves the route calls it; it proves nothing about the query, which
 * is where transactions, COALESCE semantics, conditional updates, and join
 * shapes actually live. Those are the parts that were verified by hand against
 * a live database and so were not verified repeatably at all.
 *
 * CI already provisions a migrated `stewardpos_test` Postgres for the backend
 * job and, until now, never used it for anything.
 */

/**
 * Refuse to run against anything that is not obviously a test database.
 *
 * These tests write and delete real rows. Pointed at a development database by
 * a stale `.env` — which is the ordinary accident, since the backend reads the
 * same variables — they would quietly mutate real data. The name check is crude
 * on purpose: it cannot be satisfied by accident, only deliberately.
 */
function assertTestDatabase(name: string | undefined): asserts name is string {
  if (!name) {
    throw new Error(
      'DB_NAME is not set. Integration tests need a Postgres; see the note in harness.ts.'
    );
  }
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run integration tests against "${name}": the database name must contain ` +
        '"test". These tests write and delete rows, and pointing them at a real database ' +
        'would mutate it.'
    );
  }
}

export interface Harness {
  adapter: PostgresAdapter;
  /** Direct SQL, for arranging state the adapter has no method to create. */
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  close: () => Promise<void>;
}

/**
 * Connect, or fail loudly.
 *
 * Deliberately not `describe.skip` when no database is reachable: a suite that
 * silently skips reports green having tested nothing, which is exactly the
 * failure mode that let the adapters go uncovered while CI looked healthy.
 */
export async function connect(): Promise<Harness> {
  const name = process.env.DB_NAME;
  assertTestDatabase(name);

  const adapter = new PostgresAdapter({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database: name,
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
  });

  const pool = (adapter as unknown as { pool: { query: Harness['query']; end: () => Promise<void> } })
    .pool;

  // Fail here rather than inside the first test, so an unreachable database
  // reads as "no database" rather than as a broken query.
  await pool.query('SELECT 1');

  return {
    adapter,
    query: (text, params) => pool.query(text, params),
    close: () => pool.end(),
  };
}

/** Distinct per test run, so parallel files and reruns cannot collide. */
export const tag = (): string => `it-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Remove everything a run created, matched on its tag.
 *
 * Ordered by dependency, and never a TRUNCATE: these tests share a database
 * with whatever else the suite is doing, and with a developer's own data if
 * they pointed a local test database at the same server.
 */
export async function cleanup(h: Harness, mark: string): Promise<void> {
  // `orders` carries no free-text column to tag, so orders are found through
  // the tagged products they contain rather than marked directly.
  const orders = `SELECT DISTINCT oi.order_id FROM order_items oi
                  JOIN products p ON p.id = oi.product_id WHERE p.description = $1`;
  await h.query(`DELETE FROM payments WHERE order_id IN (${orders})`, [mark]);
  await h.query(`DELETE FROM order_items WHERE order_id IN (${orders})`, [mark]);
  await h.query('DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE description = $1)', [mark]);
  await h.query('DELETE FROM products WHERE description = $1', [mark]);
  await h.query('DELETE FROM categories WHERE name LIKE $1', [`${mark}%`]);
}
