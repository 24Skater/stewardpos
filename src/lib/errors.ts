/**
 * Extract a human-readable message from a caught value.
 *
 * `catch` bindings are `unknown` under strict TypeScript, and anything can be
 * thrown — not just `Error`. This narrows safely and falls back to a caller-supplied
 * message, replacing the `catch (error: any)` + `error.message || '...'` idiom.
 *
 * `ApiClientError` extends `Error`, so API failures surface their server-provided
 * message here.
 *
 * @param error   the caught value
 * @param fallback shown when the value carries no usable message
 */
export function getErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error) {
    return error;
  }

  return fallback;
}
