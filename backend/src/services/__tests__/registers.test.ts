import { describe, it, expect, vi } from 'vitest';
import { ValidationError } from '../../utils/errors';
import {
  buildDisplayCode,
  createRegister,
  disableRegister,
  nextRegisterNumber,
  retireRegister,
  slugify,
  type CreateRegisterInput,
} from '../registers';
import type { DatabaseAdapter } from '../database';

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('Main Street')).toBe('main-street');
  });

  it('collapses runs of punctuation into a single hyphen', () => {
    expect(slugify('1st Floor / Café')).toBe('1st-floor-cafe');
  });

  it('strips diacritics via NFD normalization', () => {
    expect(slugify('Café')).toBe('cafe');
    expect(slugify('Ñoño')).toBe('nono');
  });

  it('trims leading and trailing separators', () => {
    expect(slugify('  --Coffee Shop--  ')).toBe('coffee-shop');
  });

  it('collapses multiple consecutive separators into one hyphen', () => {
    expect(slugify('A   ///   B')).toBe('a-b');
  });

  it('handles a name that is already a clean slug', () => {
    expect(slugify('church-coffee')).toBe('church-coffee');
  });
});

describe('buildDisplayCode', () => {
  it('builds MAIN-01 for a single-digit register at "main"', () => {
    expect(buildDisplayCode('main', 1)).toBe('MAIN-01');
  });

  it('builds CHURCH-COFFEE-01 for a hyphenated slug', () => {
    expect(buildDisplayCode('church-coffee', 1)).toBe('CHURCH-COFFEE-01');
  });

  it('does not pad beyond two digits for a three-digit number', () => {
    expect(buildDisplayCode('main', 12)).toBe('MAIN-12');
    expect(buildDisplayCode('main', 100)).toBe('MAIN-100');
  });

  it('slugifies a raw name before building the code', () => {
    expect(buildDisplayCode('1st Floor / Café', 3)).toBe('1ST-FLOOR-CAFE-03');
  });

  it('truncates the slug portion, never the number, to stay within 50 characters', () => {
    // 60 'a's is well past the 50-character column limit on its own.
    const longSlug = 'a'.repeat(60);
    const code = buildDisplayCode(longSlug, 7);

    expect(code.length).toBeLessThanOrEqual(50);
    // The suffix carrying the number must survive intact.
    expect(code.endsWith('-07')).toBe(true);
    expect(code).toBe(`${'A'.repeat(47)}-07`);
  });

  it('does not leave a dangling hyphen when the cut lands on a separator', () => {
    // The 47-character slug limit falls exactly on the hyphen between the two
    // words, which would otherwise produce '...A--01' — a doubled separator
    // that reads as a typo on a printed receipt rather than as a code.
    const code = buildDisplayCode(`${'a'.repeat(46)} bcdef`, 1);

    expect(code).toBe(`${'A'.repeat(46)}-01`);
    expect(code).not.toContain('--');
    expect(code.length).toBeLessThanOrEqual(50);
  });

  it('truncates the slug even further for a longer register number', () => {
    const longSlug = 'b'.repeat(60);
    const code = buildDisplayCode(longSlug, 12345);

    expect(code.length).toBeLessThanOrEqual(50);
    expect(code.endsWith('-12345')).toBe(true);
  });

  it('stays at exactly 50 characters when the slug lands exactly on the boundary', () => {
    const slug = 'c'.repeat(47);
    const code = buildDisplayCode(slug, 1);

    expect(code).toBe(`${'C'.repeat(47)}-01`);
    expect(code.length).toBe(50);
  });
});

describe('nextRegisterNumber', () => {
  it('returns 1 for an empty location', () => {
    expect(nextRegisterNumber([])).toBe(1);
  });

  it('returns the next number after a contiguous run', () => {
    expect(nextRegisterNumber([1, 2, 3])).toBe(4);
  });

  it('fills the lowest gap rather than appending', () => {
    expect(nextRegisterNumber([1, 3])).toBe(2);
  });

  it('does not depend on input order', () => {
    expect(nextRegisterNumber([3, 1])).toBe(2);
    expect(nextRegisterNumber([5, 1, 3, 2])).toBe(4);
  });

  it('does not reuse a number that is absent only because it was retired', () => {
    // getUsedRegisterNumbers deliberately includes retired registers, so a
    // caller passing [1, 2] here (2 being retired) must still get 3, not 2.
    expect(nextRegisterNumber([1, 2])).toBe(3);
  });

  it('assigns a genuinely absent number when one exists', () => {
    expect(nextRegisterNumber([1, 2, 4])).toBe(3);
  });
});

/**
 * A minimal stand-in for the adapter's register/location surface.
 *
 * `getOpenShiftForRegister` defaults to no open shift, so every existing test
 * in this file that doesn't care about shifts stays a no-op on that path —
 * `getOpenShift` (services/registerShifts.ts) short-circuits without ever
 * reaching `getRegisterById` or `endRegisterShift` when there is nothing open.
 */
function stubAdapter(overrides: Partial<Record<string, any>> = {}): DatabaseAdapter {
  const defaults = {
    getLocationById: vi.fn(),
    getOrgPolicy: vi.fn().mockResolvedValue(null),
    countRegistersForCap: vi.fn().mockResolvedValue(0),
    getUsedRegisterNumbers: vi.fn().mockResolvedValue([]),
    createRegister: vi.fn(),
    getOpenShiftForRegister: vi.fn().mockResolvedValue(null),
    getRegisterById: vi.fn().mockResolvedValue(null),
    endRegisterShift: vi.fn(),
  };
  return { ...defaults, ...overrides } as unknown as DatabaseAdapter;
}

const BASE_INPUT: CreateRegisterInput = {
  orgId: 'org-1',
  locationId: 'loc-1',
  name: 'Register 1',
};

describe('createRegister orchestration', () => {
  it('returns bad_location when the location does not exist', async () => {
    const adapter = stubAdapter({ getLocationById: vi.fn().mockResolvedValue(null) });

    const result = await createRegister(adapter, BASE_INPUT);

    expect(result).toBe('bad_location');
  });

  it('returns bad_location when the location belongs to a different org', async () => {
    const adapter = stubAdapter({
      getLocationById: vi.fn().mockResolvedValue({ id: 'loc-1', orgId: 'org-2', slug: 'main' }),
    });

    const result = await createRegister(adapter, BASE_INPUT);

    expect(result).toBe('bad_location');
  });

  it('returns limitReached with the cap when the org is at its register cap', async () => {
    const adapter = stubAdapter({
      getLocationById: vi.fn().mockResolvedValue({ id: 'loc-1', orgId: 'org-1', slug: 'main' }),
      getOrgPolicy: vi.fn().mockResolvedValue({ maxRegisters: 3, pinLength: 6 }),
      countRegistersForCap: vi.fn().mockResolvedValue(3),
    });

    const result = await createRegister(adapter, BASE_INPUT);

    expect(result).toEqual({ limitReached: 3 });
    expect(adapter.createRegister).not.toHaveBeenCalled();
  });

  it('proceeds when the cap is null (unlimited)', async () => {
    const createRegisterMock = vi.fn().mockResolvedValue({ id: 'r1', displayCode: 'MAIN-01' });
    const adapter = stubAdapter({
      getLocationById: vi.fn().mockResolvedValue({ id: 'loc-1', orgId: 'org-1', slug: 'main' }),
      getOrgPolicy: vi.fn().mockResolvedValue({ maxRegisters: null, pinLength: 6 }),
      countRegistersForCap: vi.fn().mockResolvedValue(999),
      createRegister: createRegisterMock,
    });

    const result = await createRegister(adapter, BASE_INPUT);

    expect(result).toEqual({ id: 'r1', displayCode: 'MAIN-01' });
    expect(createRegisterMock).toHaveBeenCalled();
  });

  it('proceeds when the org has no policy row at all', async () => {
    const createRegisterMock = vi.fn().mockResolvedValue({ id: 'r1', displayCode: 'MAIN-01' });
    const adapter = stubAdapter({
      getLocationById: vi.fn().mockResolvedValue({ id: 'loc-1', orgId: 'org-1', slug: 'main' }),
      getOrgPolicy: vi.fn().mockResolvedValue(null),
      createRegister: createRegisterMock,
    });

    const result = await createRegister(adapter, BASE_INPUT);

    expect(result).toEqual({ id: 'r1', displayCode: 'MAIN-01' });
  });

  it('assigns the next register number and the derived display code on the happy path', async () => {
    const createRegisterMock = vi.fn().mockImplementation(async (payload) => ({
      id: 'r2',
      ...payload,
    }));
    const adapter = stubAdapter({
      getLocationById: vi.fn().mockResolvedValue({ id: 'loc-1', orgId: 'org-1', slug: 'church-coffee' }),
      getUsedRegisterNumbers: vi.fn().mockResolvedValue([1, 3]),
      createRegister: createRegisterMock,
    });

    await createRegister(adapter, BASE_INPUT);

    expect(createRegisterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        register_number: 2,
        display_code: 'CHURCH-COFFEE-02',
        org_id: 'org-1',
        location_id: 'loc-1',
      })
    );
  });

  it('uppercases and passes through a caller-supplied display code override', async () => {
    const createRegisterMock = vi.fn().mockImplementation(async (payload) => ({
      id: 'r3',
      ...payload,
    }));
    const adapter = stubAdapter({
      getLocationById: vi.fn().mockResolvedValue({ id: 'loc-1', orgId: 'org-1', slug: 'main' }),
      createRegister: createRegisterMock,
    });

    await createRegister(adapter, { ...BASE_INPUT, displayCode: 'custom-code' });

    expect(createRegisterMock).toHaveBeenCalledWith(
      expect.objectContaining({ display_code: 'CUSTOM-CODE' })
    );
  });

  it('throws ValidationError for an override longer than 50 characters', async () => {
    const adapter = stubAdapter({
      getLocationById: vi.fn().mockResolvedValue({ id: 'loc-1', orgId: 'org-1', slug: 'main' }),
    });

    await expect(
      createRegister(adapter, { ...BASE_INPUT, displayCode: 'x'.repeat(51) })
    ).rejects.toThrow(ValidationError);
  });

  it('passes through duplicate_number from the adapter', async () => {
    const adapter = stubAdapter({
      getLocationById: vi.fn().mockResolvedValue({ id: 'loc-1', orgId: 'org-1', slug: 'main' }),
      createRegister: vi.fn().mockResolvedValue('duplicate_number'),
    });

    expect(await createRegister(adapter, BASE_INPUT)).toBe('duplicate_number');
  });

  it('passes through duplicate_code from the adapter', async () => {
    const adapter = stubAdapter({
      getLocationById: vi.fn().mockResolvedValue({ id: 'loc-1', orgId: 'org-1', slug: 'main' }),
      createRegister: vi.fn().mockResolvedValue('duplicate_code'),
    });

    expect(await createRegister(adapter, BASE_INPUT)).toBe('duplicate_code');
  });
});

describe('retireRegister', () => {
  it('sets status to retired', async () => {
    const setRegisterStatus = vi.fn().mockResolvedValue({ id: 'r1', status: 'retired' });
    const adapter = stubAdapter({ setRegisterStatus });

    const result = await retireRegister(adapter, 'r1');

    expect(setRegisterStatus).toHaveBeenCalledWith('r1', 'retired');
    expect(result).toEqual({ id: 'r1', status: 'retired' });
  });

  it('returns null when the register does not exist', async () => {
    const adapter = stubAdapter({ setRegisterStatus: vi.fn().mockResolvedValue(null) });

    expect(await retireRegister(adapter, 'missing')).toBeNull();
  });

  it('ends the register\'s open shift with reason "forced" — a retired till must not keep authorizing whoever is mid-shift on it', async () => {
    const setRegisterStatus = vi.fn().mockResolvedValue({ id: 'r1', status: 'retired' });
    const endRegisterShift = vi.fn().mockResolvedValue({ id: 's1', endedAt: Date.now(), endReason: 'forced' });
    const adapter = stubAdapter({
      setRegisterStatus,
      getOpenShiftForRegister: vi.fn().mockResolvedValue({
        id: 's1', registerId: 'r1', lastActivityAt: Date.now(), endedAt: null,
      }),
      getRegisterById: vi.fn().mockResolvedValue({ id: 'r1', idleLockSeconds: 300 }),
      endRegisterShift,
    });

    await retireRegister(adapter, 'r1');

    expect(endRegisterShift).toHaveBeenCalledWith('s1', 'forced');
  });

  it('is a no-op on shifts when the register has none open', async () => {
    const endRegisterShift = vi.fn();
    const adapter = stubAdapter({
      setRegisterStatus: vi.fn().mockResolvedValue({ id: 'r1', status: 'retired' }),
      endRegisterShift,
    });

    await retireRegister(adapter, 'r1');

    expect(endRegisterShift).not.toHaveBeenCalled();
  });
});

describe('disableRegister', () => {
  it('sets status to disabled, distinct from retired', async () => {
    const setRegisterStatus = vi.fn().mockResolvedValue({ id: 'r1', status: 'disabled' });
    const adapter = stubAdapter({ setRegisterStatus });

    const result = await disableRegister(adapter, 'r1');

    expect(setRegisterStatus).toHaveBeenCalledWith('r1', 'disabled');
    expect(result).toEqual({ id: 'r1', status: 'disabled' });
  });

  it('ends the register\'s open shift with reason "forced", the same as retiring', async () => {
    const setRegisterStatus = vi.fn().mockResolvedValue({ id: 'r1', status: 'disabled' });
    const endRegisterShift = vi.fn().mockResolvedValue({ id: 's1', endedAt: Date.now(), endReason: 'forced' });
    const adapter = stubAdapter({
      setRegisterStatus,
      getOpenShiftForRegister: vi.fn().mockResolvedValue({
        id: 's1', registerId: 'r1', lastActivityAt: Date.now(), endedAt: null,
      }),
      getRegisterById: vi.fn().mockResolvedValue({ id: 'r1', idleLockSeconds: 300 }),
      endRegisterShift,
    });

    await disableRegister(adapter, 'r1');

    expect(endRegisterShift).toHaveBeenCalledWith('s1', 'forced');
  });
});
