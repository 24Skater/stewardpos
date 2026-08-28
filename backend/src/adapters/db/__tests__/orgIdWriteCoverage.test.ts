import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

/**
 * The trap in the multi-tenant migration plan.
 *
 * `docs/guides/multi-tenant.md` step 1 said: backfill `org_id` on every row,
 * then make the column `NOT NULL` — "do this while there is still only one
 * organization, it is a no-op then".
 *
 * It is not a no-op. Not one of the forty-odd `INSERT`s in the two adapters
 * names `org_id`, so the constraint rejects every single one of them. Verified
 * against a real Postgres: after `ALTER TABLE customers ALTER COLUMN org_id SET
 * NOT NULL`, creating a customer fails with
 *
 *     null value in column "org_id" of relation "customers"
 *     violates not-null constraint
 *
 * which is a shop that cannot take a sale, arrived at by following the runbook.
 *
 * The order that works is `SET DEFAULT` first, then `SET NOT NULL` — or scoping
 * the writes first. The document now says so.
 *
 * This test is what keeps it true. It fails the moment somebody adds the
 * constraint without also giving every write a value to satisfy it, which is
 * the failure the document previously invited.
 */

const MIGRATIONS = path.resolve(__dirname, '../../../../migrations/postgres');
const ADAPTERS = path.resolve(__dirname, '..');

const migrationSql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS, f), 'utf8'))
  .join('\n');

const adapterSource = ['PostgresAdapter.ts', 'SQLiteAdapter.ts']
  .map((f) => readFileSync(path.join(ADAPTERS, f), 'utf8'))
  .join('\n');

/** Tables that carry `org_id` at all, per migration 014. */
function tenantTables(): string[] {
  const found = new Set<string>();
  // Postgres 014 adds them through a `tenant_tables TEXT[] := ARRAY[...]`.
  const marker = 'tenant_tables TEXT[] := ARRAY[';
  const at = migrationSql.indexOf(marker);
  if (at === -1) throw new Error('migration 014 no longer declares tenant_tables');
  // From *after* the opening bracket: `TEXT[]` in the declaration itself has a
  // closing bracket of its own, and searching from the start of the marker
  // finds that one and yields an empty list.
  const open = at + marker.length;
  const block = migrationSql.slice(open, migrationSql.indexOf(']', open));
  for (const match of block.matchAll(/'([a-z_]+)'/g)) found.add(match[1]);
  return [...found];
}

/**
 * Tables whose `org_id` has been made NOT NULL by some migration.
 *
 * Empty today. It is the antecedent of the rule below, and the whole point is
 * that filling it in is what arms the check.
 */
function tablesRequiringOrgId(): string[] {
  const required = new Set<string>();
  for (const match of migrationSql.matchAll(
    /ALTER\s+TABLE\s+(?:ONLY\s+)?([a-z_]+)\s+ALTER\s+COLUMN\s+org_id\s+SET\s+NOT\s+NULL/gi
  )) {
    required.add(match[1]);
  }
  return [...required];
}

/** Every `INSERT INTO <table> (columns...)` in either adapter, including multi-line ones. */
function insertsByTable(): Map<string, string[]> {
  const inserts = new Map<string, string[]>();
  for (const match of adapterSource.matchAll(/INSERT\s+INTO\s+([a-z_]+)\s*\(([^)]*)\)/gi)) {
    const table = match[1];
    const columns = match[2];
    if (!inserts.has(table)) inserts.set(table, []);
    inserts.get(table)!.push(columns);
  }
  return inserts;
}

/** Whitespace-flattened migration SQL, so a statement split over lines still matches. */
const flatSql = migrationSql.replace(/\s+/g, ' ').toUpperCase();

/**
 * Whether some migration gave this table's `org_id` a DEFAULT.
 *
 * A substring test on flattened SQL rather than a built regex. The regex
 * version of this lived in a template literal, where `\s` collapses to a bare
 * `s` and the pattern matched nothing at all - so the check silently reported
 * "no default" for every table and failed the safe migration as loudly as the
 * dangerous one. Caught by probing the test with both.
 */
function hasOrgIdDefault(table: string): boolean {
  const name = table.toUpperCase();
  return (
    flatSql.includes(`ALTER TABLE ${name} ALTER COLUMN ORG_ID SET DEFAULT`) ||
    flatSql.includes(`ALTER TABLE ONLY ${name} ALTER COLUMN ORG_ID SET DEFAULT`)
  );
}

describe('org_id write coverage', () => {
  it('reads the migrations and adapters it is meant to be checking', () => {
    // Without this, a moved path would make the rule below pass by finding
    // nothing - the exact shape of vacuous test this file exists to prevent.
    expect(tenantTables().length).toBeGreaterThanOrEqual(20);
    const total = [...insertsByTable().values()].reduce((n, list) => n + list.length, 0);
    expect(total).toBeGreaterThanOrEqual(40);
  });

  it('leaves every required org_id with something to satisfy it', () => {
    /**
     * One rule, two acceptable ways to satisfy it.
     *
     * A table whose `org_id` is `NOT NULL` is safe if either the column has a
     * `DEFAULT` (existing writes keep working and land in the default org) or
     * every insert into it names the column. Neither, and every one of those
     * writes fails the moment the migration lands.
     */
    const inserts = insertsByTable();
    const offenders: string[] = [];

    for (const table of tablesRequiringOrgId()) {
      if (hasOrgIdDefault(table)) continue;

      const blind = (inserts.get(table) ?? []).filter((cols) => !/\borg_id\b/.test(cols));
      for (const cols of blind) {
        offenders.push(`INSERT INTO ${table} (${cols.trim().slice(0, 50)}...)`);
      }
    }

    expect(
      offenders,
      'A migration made org_id NOT NULL on a table whose inserts do not set it, ' +
        'and the column has no DEFAULT to fall back on. Every one of these writes ' +
        'will fail at runtime. Give the column a DEFAULT in the same migration, or ' +
        'set org_id on the write first - see docs/guides/multi-tenant.md step 1.'
    ).toEqual([]);
  });

  it('documents the corrected order rather than the one that breaks', () => {
    // The prose is the thing somebody will actually follow at 2am.
    const guide = readFileSync(
      path.resolve(__dirname, '../../../../../docs/guides/multi-tenant.md'),
      'utf8'
    );
    expect(guide).toMatch(/SET DEFAULT/);
    expect(guide).not.toMatch(/it is a no-op then/);
  });
});
