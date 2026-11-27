/**
 * Customer phones are stored as 10 bare digits (US) and shown as (202) 538-1154.
 * Mirrors backend/src/utils/phone.ts, which enforces the same shape.
 */
export const PHONE_DIGITS = 10;

/** Digits only, a leading US country code dropped, capped at 10. */
export function phoneDigits(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.length > PHONE_DIGITS && digits.startsWith('1')) digits = digits.slice(1);
  return digits.slice(0, PHONE_DIGITS);
}

/**
 * Display form, also used while typing. No "(" until the 4th digit, so
 * backspacing through the area code never gets stuck on a lone parenthesis.
 */
export function formatPhone(value?: string | null): string {
  const d = phoneDigits(value ?? '');
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
