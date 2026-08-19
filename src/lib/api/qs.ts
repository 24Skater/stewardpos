/**
 * Build a query string from an options object, omitting empty values.
 *
 * `undefined`, `null`, and `''` are dropped rather than sent as blanks, so a
 * caller can pass a query type with unset fields and get a clean URL. Returns
 * `''` (not `'?'`) when nothing survives, keeping it safe to append.
 *
 * Takes any object rather than an index-signature type so the hand-written query
 * interfaces in this directory can be passed directly. A `string[]` is joined
 * comma-separated (`?registerIds=a,b`) — the form the reporting filters use and
 * that `parseIdList` on the backend already splits back apart — and an empty
 * array is dropped entirely rather than sent as `?registerIds=`, matching "no
 * filter" rather than "filter to nothing". Any other non-primitive value is
 * skipped, since no endpoint expects one in the query.
 */
export function qs(params?: object): string {
  if (!params) return '';

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
      continue;
    }
    if (typeof value === 'object') continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}
