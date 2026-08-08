/**
 * Escape the wildcards a LIKE pattern gives special meaning.
 *
 * Search terms are parameterised, so this is not an injection concern — it is a
 * correctness one. Unescaped, a search for `%` matched every product in the
 * catalog, and `_` matched any single character, so searching for "50% off"
 * returned things that do not contain it.
 *
 * Caught by the first integration test written against a real database. The
 * route tests could not see it: they mock the adapter, so the LIKE never ran.
 *
 * Backslash first, or it would double-escape the escapes added after it.
 *
 * Postgres treats backslash as the default LIKE escape. SQLite has no default
 * and needs the ESCAPE clause spelled out in the query — see the SQLite adapter.
 */
export function escapeLike(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/[%_]/g, (char) => `\\${char}`);
}
