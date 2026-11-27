import { describe, it, expect } from 'vitest';
import { formatPhone, phoneDigits } from '../phone';

describe('phoneDigits', () => {
  it('keeps digits only, drops a US country code and caps at 10', () => {
    expect(phoneDigits('(202) 538-1154')).toBe('2025381154');
    expect(phoneDigits('+1 202 538 1154')).toBe('2025381154');
    expect(phoneDigits('20253811549999')).toBe('2025381154');
    expect(phoneDigits('abc')).toBe('');
  });
});

describe('formatPhone', () => {
  it.each([
    ['', ''],
    ['202', '202'],
    ['2025', '(202) 5'],
    ['202538', '(202) 538'],
    ['2025381', '(202) 538-1'],
    ['2025381154', '(202) 538-1154'],
  ])('formats %s as %s', (digits, shown) => {
    expect(formatPhone(digits)).toBe(shown);
  });

  it('handles a missing phone', () => {
    expect(formatPhone(undefined)).toBe('');
  });
});
