/**
 * Where to send someone once they have signed in.
 *
 * `RequireAuth` records the route it turned away in `?next=`, as
 * `pathname + search`, so a legitimate value is always a site-relative path.
 * Anything that can escape the origin has to be refused: a login page that
 * forwards to an attacker's host is a stock phishing primitive, and the link
 * carrying it is indistinguishable from a real one.
 */
export const DEFAULT_REDIRECT = '/pos';

/**
 * Whether `next` leaves this origin.
 *
 * A leading `//` is the obvious escape, but it is not the only spelling of it:
 * both the browser and react-router read a backslash in the authority position
 * as a slash, so `/\evil.example` is delivered as `//evil.example`. Normalising
 * backslashes before the test is what closes that door — testing for a literal
 * `//` is the check that CVE-2025-68470's first fix was found to have missed,
 * and react-router carries it until v7.18.0.
 *
 * `?next=` arrives already percent-decoded from `URLSearchParams`, so there is
 * no second encoding layer left to unwrap here.
 */
function escapesOrigin(next: string): boolean {
  const normalized = next.replace(/\\/g, '/');
  return !normalized.startsWith('/') || normalized.startsWith('//');
}

export function safeRedirect(next: string | null): string {
  if (!next || escapesOrigin(next)) return DEFAULT_REDIRECT;
  return next;
}
