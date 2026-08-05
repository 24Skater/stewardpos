/**
 * Shared types for the database adapters.
 */

/**
 * A raw row as returned by a database driver.
 *
 * Columns are indexed rather than declared per entity because these adapters run
 * hand-written SQL whose result shape varies per query — `SELECT *` alongside joins
 * and aliased aggregates such as `GROUP_CONCAT(r.id) as role_ids` or
 * `json_agg(...) as roles`. A row is only meaningful once the mapper directly below
 * its query has interpreted it.
 *
 * This is deliberately permissive and is **not** a substitute for typing the data
 * layer properly. It exists so the project has a compiling floor; real per-query
 * result types belong with the data-layer rework in Phase 1, where the SQL and its
 * mappers are being rewritten anyway. Prefer narrowing at the mapper over widening
 * this type further.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbRow = Record<string, any>;

/**
 * Read a collection field off an untyped payload.
 *
 * Adapter methods take `Record<string, unknown>` payloads, so nested collections
 * arrive untyped. Returns an empty array for anything that is not an array, which
 * also removes a real hazard: the previous `payload.items.length` accesses would
 * throw at runtime whenever the field was present but not an array.
 */
export function asRows(value: unknown): DbRow[] {
  return Array.isArray(value) ? value : [];
}
