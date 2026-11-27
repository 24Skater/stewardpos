import { z } from 'zod';

/**
 * Customer phones are stored as 10 bare digits (US), so a sale and its customer
 * record match exactly however the number was typed.
 * shortcut: US/NANP only; widen when the store takes international numbers.
 */
export function normalizePhone(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/** A customer's phone: 10 digits, or '' to clear it. */
export const phoneSchema = z.preprocess(
  normalizePhone,
  z.string().regex(/^(\d{10})?$/, 'Phone must be a 10-digit number')
);
