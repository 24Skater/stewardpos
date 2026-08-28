import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  findPasswordProblems,
  passwordSchema,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
} from '../passwordPolicy';

describe('findPasswordProblems', () => {
  it('accepts an ordinary strong password', () => {
    expect(findPasswordProblems('correct-horse-battery-staple')).toEqual([]);
  });

  it('accepts twelve characters with no composition rules met', () => {
    // The policy is length-based on purpose: no uppercase, digit or symbol is
    // demanded, because those rules mostly produce `Password1!`.
    expect(findPasswordProblems('mangotrellis')).toEqual([]);
  });

  it('refuses anything under the minimum', () => {
    expect(findPasswordProblems('short')).toContain(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    );
    // The old admin-route floor, which this replaces.
    expect(findPasswordProblems('abc123')).not.toEqual([]);
    // The old setup-route floor.
    expect(findPasswordProblems('12345678')).not.toEqual([]);
  });

  it('refuses more than bcrypt will actually read', () => {
    // Silently truncating means two different passphrases sharing a 72-byte
    // prefix both open the account.
    const tooLong = 'a'.repeat(MAX_PASSWORD_BYTES + 1);
    expect(findPasswordProblems(tooLong).join(' ')).toMatch(/at most 72 bytes/);
  });

  it('counts bytes rather than characters for the ceiling', () => {
    // Twenty emoji is twenty characters and eighty bytes. A character count
    // would wave it through and bcrypt would still truncate it.
    const emoji = '🔒'.repeat(20);
    expect(emoji.length).toBeLessThan(MAX_PASSWORD_BYTES);
    expect(findPasswordProblems(emoji).join(' ')).toMatch(/at most 72 bytes/);
  });

  it('refuses common passwords that are long enough to pass the length rule', () => {
    for (const bad of ['password1234', 'change_this_password', '123456789012']) {
      expect(bad.length, `${bad} should be testing the list, not the length`).toBeGreaterThanOrEqual(
        MIN_PASSWORD_LENGTH
      );
      expect(findPasswordProblems(bad), bad).not.toEqual([]);
    }
  });

  it('refuses the seeded demo credential', () => {
    // `seeder.ts` uses this, and a demo install that goes live keeps it.
    expect(findPasswordProblems('DemoPass!1')).not.toEqual([]);
  });

  it('refuses a repeated character or a straight sequence', () => {
    expect(findPasswordProblems('aaaaaaaaaaaaaa')).not.toEqual([]);
    expect(findPasswordProblems('abcdefghijkl')).not.toEqual([]);
    expect(findPasswordProblems('zyxwvutsrqpo')).not.toEqual([]);
  });

  it('refuses a password built from the address it protects', () => {
    const problems = findPasswordProblems('ada.lovelace-2026', {
      email: 'ada.lovelace@shop.example',
    });
    expect(problems).toContain('Password must not contain your email address');
  });

  it('refuses a password built from the account holder name', () => {
    const problems = findPasswordProblems('grace hopper 1906', { name: 'Grace Hopper' });
    expect(problems).toContain('Password must not contain your name');
  });

  it('does not treat a very short local part as a substring to avoid', () => {
    // `jo@shop.example` must not forbid every password containing "jo".
    expect(findPasswordProblems('jonquil-meadow-77', { email: 'jo@shop.example' })).toEqual([]);
  });

  it('reports every problem at once', () => {
    // Same reasoning as findWeakSecrets: one fix, one retry.
    const problems = findPasswordProblems('ada', { email: 'ada@shop.example' });
    expect(problems.length).toBeGreaterThan(1);
  });
});

describe('the fixtures that have to satisfy this policy', () => {
  /**
   * The E2E suite creates a till user through `POST /api/admin/users`, so its
   * password is subject to this policy like any other.
   *
   * That is not hypothetical: tightening the minimum from six to twelve broke
   * `global-setup.ts`, which used the seeded `DemoPass!1` — ten characters and
   * on the forbidden list. The POST's response was not checked, so the only
   * symptom was a lookup failing twenty lines later. Read out of the E2E source
   * rather than copied, so the next person to tighten the rule finds out here,
   * in seconds, instead of in a CI run.
   */
  it('accepts the password e2e/global-setup.ts creates its till user with', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../../../e2e/global-setup.ts'),
      'utf8'
    );
    const block = source.slice(source.indexOf('const TILL_USER'), source.indexOf('};', source.indexOf('const TILL_USER')));

    const read = (field: string): string => {
      const marker = `${field}: '`;
      const at = block.indexOf(marker);
      if (at === -1) throw new Error(`TILL_USER has no ${field}`);
      return block.slice(at + marker.length, block.indexOf("'", at + marker.length));
    };

    const password = read('password');
    expect(password.length).toBeGreaterThan(0);

    expect(
      findPasswordProblems(password, { email: read('email'), name: read('name') }),
      'e2e/global-setup.ts creates its till user through POST /api/admin/users, ' +
        'so this password must satisfy the policy. Update the fixture there.'
    ).toEqual([]);
  });
});

describe('passwordSchema', () => {
  it('accepts a good password', () => {
    expect(passwordSchema.safeParse('correct-horse-battery-staple').success).toBe(true);
  });

  it('rejects a weak one with the reason', () => {
    const result = passwordSchema.safeParse('abc123');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toMatch(/at least 12 characters/);
    }
  });

  it('checks only what it can see', () => {
    // The schema has no account context, so an email-derived password passes
    // here and is caught by the route's own findPasswordProblems call. This
    // asserts the division of labour rather than an accident.
    expect(passwordSchema.safeParse('ada.lovelace-2026').success).toBe(true);
  });
});
