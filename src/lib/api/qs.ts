/**
 * Build a query string from an options object, omitting empty values.
 *
 * `undefined`, `null`, and `''` are dropped rather than sent as blanks, so a
 * caller can pass a query type with unset fields and get a clean URL. Returns
 * `''` (not `'?'`) when nothing survives, keeping it safe to append.
 *
 * Takes any object rather than an index-signature type so the hand-written query
 * interfaces in this directory can be passed directly; non-primitive values are
 * skipped because the backend has no endpoint that expects one in the query.
 */
export function qs(params?: object): string {
  if (!params) return '';

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'object') continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}
