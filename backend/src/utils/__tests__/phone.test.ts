import { describe, it, expect } from 'vitest';
import { normalizePhone, phoneSchema } from '../phone';

describe('phone', () => {
  it.each([
    ['(202) 538-1154', '2025381154'],
    ['202.538.1154', '2025381154'],
    ['+1 202 538 1154', '2025381154'],
    ['', ''],
  ])('normalises %s', (input, digits) => {
    expect(normalizePhone(input)).toBe(digits);
  });

  it('accepts 10 digits or empty, rejects anything else', () => {
    expect(phoneSchema.parse('(202) 538-1154')).toBe('2025381154');
    expect(phoneSchema.parse('')).toBe('');
    expect(() => phoneSchema.parse('538-1154')).toThrow('10-digit');
  });
});
