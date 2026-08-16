/**
 * What actually changed in an audited mutation.
 *
 * The audit log stores whole `before` and `after` snapshots, and the screen used
 * to print both as raw JSON side by side. For a product with twenty fields that
 * means reading two twenty-line blobs to find the one number that moved, which
 * is the question anyone opening an audit entry is there to answer.
 */

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/**
 * Compare two snapshots, deeply enough to be honest and no deeper.
 *
 * Values are compared by their JSON serialisation. That is exact for the scalars
 * these records hold and correct-if-strict for nested objects: a nested object
 * whose keys were reordered would read as changed. Worth it, because the
 * alternative — reference equality — reports every nested object as changed on
 * every edit, and a diff that flags everything flags nothing.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' && typeof b !== 'object') return false;

  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    // A cyclic snapshot cannot be compared this way; treat it as changed rather
    // than throwing inside a rendering path.
    return false;
  }
}

/**
 * The changed fields only, in a stable order.
 *
 * A field present on one side and not the other counts as a change — a create
 * has no `before`, a delete has no `after`, and both should show what the record
 * held rather than an empty panel.
 */
export function diffRecords(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): FieldChange[] {
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  return [...fields]
    .sort()
    .filter((field) => !sameValue(before?.[field], after?.[field]))
    .map((field) => ({ field, before: before?.[field], after: after?.[field] }));
}

/** A field value as one readable line. */
export function formatValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
