import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  describePasswordProblem,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
} from '../password-policy';

describe('describePasswordProblem', () => {
  it('accepts an ordinary strong password', () => {
    expect(describePasswordProblem('correct-horse-battery-staple')).toBeNull();
  });

  it('refuses anything under the minimum', () => {
    expect(describePasswordProblem('12345678')).toMatch(/at least 12 characters/);
  });

  it('counts bytes for the ceiling', () => {
    const emoji = '🔒'.repeat(20);
    expect(emoji.length).toBeLessThan(MAX_PASSWORD_BYTES);
    expect(describePasswordProblem(emoji)).toMatch(/at most 72 bytes/);
  });

  it('refuses common and trivial passwords', () => {
    expect(describePasswordProblem('password1234')).not.toBeNull();
    expect(describePasswordProblem('abcdefghijkl')).not.toBeNull();
    expect(describePasswordProblem('aaaaaaaaaaaaaa')).not.toBeNull();
  });

  it('refuses a password built from the account it protects', () => {
    expect(
      describePasswordProblem('ada.lovelace-2026', { email: 'ada.lovelace@shop.example' })
    ).toMatch(/email address/);
    expect(describePasswordProblem('grace hopper 1906', { name: 'Grace Hopper' })).toMatch(/name/);
  });

  it('returns one message, because the caller is a toast', () => {
    const problem = describePasswordProblem('ada', { email: 'ada@shop.example' });
    expect(typeof problem).toBe('string');
  });
});

describe('agreement with the server', () => {
  /**
   * The browser copy is advice; the server copy is enforcement. They are
   * allowed to be separate files - the frontend cannot import from `backend/`
   * - but they are not allowed to disagree, because a wizard that accepts what
   * the API then refuses is worse than no client-side check at all.
   *
   * Read out of the server source rather than duplicated as a literal here, so
   * this cannot pass while the two files differ.
   */
  const serverSource = readFileSync(
    path.resolve(__dirname, '../../../backend/src/services/passwordPolicy.ts'),
    'utf8'
  );

  function serverConstant(name: string): number {
    // Parsed by hand rather than with a regex literal: the value is read from
    // a line of the form `export const NAME = 12;`.
    const marker = `export const ${name} = `;
    const at = serverSource.indexOf(marker);
    if (at === -1) throw new Error(`${name} not found in the server policy`);
    const value = Number.parseInt(serverSource.slice(at + marker.length), 10);
    if (Number.isNaN(value)) throw new Error(`${name} is not a number in the server policy`);
    return value;
  }

  it('uses the same minimum length', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(serverConstant('MIN_PASSWORD_LENGTH'));
  });

  it('uses the same byte ceiling', () => {
    expect(MAX_PASSWORD_BYTES).toBe(serverConstant('MAX_PASSWORD_BYTES'));
  });

  it('forbids the same list of values', () => {
    const block = serverSource.slice(
      serverSource.indexOf('const FORBIDDEN'),
      serverSource.indexOf('];', serverSource.indexOf('const FORBIDDEN'))
    );
    const serverForbidden = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(serverForbidden.length).toBeGreaterThan(5);

    for (const value of serverForbidden) {
      expect(describePasswordProblem(value), `client should refuse ${value}`).not.toBeNull();
    }
  });
});
