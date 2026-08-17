import { describe, it, expect } from 'vitest';
import { bars, CODE39_PATTERNS, isEncodable, sanitize, toSvg } from '../code39';

/**
 * Code 39.
 *
 * The receipt used to print a solid black rectangle where the barcode goes —
 * class name `barcode-placeholder`, right above the `*38A509AC*` that Code 39's
 * delimiters imply. It could not be scanned, so the returns desk typed the order
 * id by hand off a receipt that appeared to carry a barcode.
 *
 * The table is checked structurally rather than by eye. A transcription slip in
 * a barcode does not produce a broken image; it produces a barcode that scans
 * cleanly as the wrong thing, which nobody notices until a return is opened
 * against someone else's sale.
 */
describe('the pattern table', () => {
  const entries = Object.entries(CODE39_PATTERNS);

  it('covers every character an order id can contain', () => {
    // 0-9, A-Z, `-`, `.`, plus the `*` delimiter. Space, $, /, + and % are
    // deliberately excluded — see the note in the module.
    expect(entries).toHaveLength(39);
    for (const character of '0123456789ABCDEF') {
      expect(CODE39_PATTERNS[character]).toBeDefined();
    }
  });

  it.each(entries)('%s is nine elements', (_char, pattern) => {
    expect(pattern).toHaveLength(9);
  });

  it.each(entries)('%s has exactly three wide elements', (_char, pattern) => {
    // The defining property of Code 39 — and the one a typo breaks.
    expect([...pattern].filter((e) => e === 'w')).toHaveLength(3);
  });

  it.each(entries)('%s has two wide bars and one wide space', (_char, pattern) => {
    // Uniform across every character in this table, which is why the five that
    // break the shape were left out. Bars are the even positions, spaces the
    // odd ones: a transposition keeping three wides but moving one across the
    // bar/space boundary survives the test above and fails this one.
    const wideBars = [...pattern].filter((e, i) => e === 'w' && i % 2 === 0);
    const wideSpaces = [...pattern].filter((e, i) => e === 'w' && i % 2 === 1);

    expect(wideBars).toHaveLength(2);
    expect(wideSpaces).toHaveLength(1);
  });

  it('assigns every character a distinct pattern', () => {
    // Two characters sharing a pattern is the failure that scans as the wrong
    // value rather than as nothing.
    expect(new Set(entries.map(([, p]) => p)).size).toBe(entries.length);
  });
});

describe('sanitize', () => {
  it('upper-cases, because Code 39 has no lower case', () => {
    expect(sanitize('a1b2')).toBe('A1B2');
  });

  it('drops what cannot be encoded rather than refusing', () => {
    // A receipt with a barcode of the encodable part beats a receipt with an
    // error printed on it.
    expect(sanitize('38A5#09@AC')).toBe('38A509AC');
  });

  it('strips a delimiter out of the payload', () => {
    // `*` terminates the symbol. Left in the middle it ends the barcode early
    // and the rest scans as garbage.
    expect(sanitize('38*A509')).toBe('38A509');
  });
});

describe('isEncodable', () => {
  it('accepts the uppercase hex an order id is made of', () => {
    expect(isEncodable('38A509AC')).toBe(true);
  });

  it('rejects a payload containing the delimiter', () => {
    expect(isEncodable('38*A5')).toBe(false);
  });

  it('rejects characters outside the set', () => {
    expect(isEncodable('order#1')).toBe(false);
  });
});

describe('bars', () => {
  it('wraps the value in start and stop characters', () => {
    // Three characters encoded means five symbols: * A B C *.
    const narrow = 1;
    const ratio = 3;
    const { width } = bars('ABC', { narrow, ratio });

    // Each symbol is 6 narrow + 3 wide = 6 + 9 = 15 units at this ratio, and
    // five symbols are separated by four narrow gaps.
    expect(width).toBe(5 * 15 + 4 * narrow);
  });

  it('draws bars only, never spaces', () => {
    // Five bars per symbol, five symbols for a three-character payload.
    expect(bars('ABC').bars).toHaveLength(25);
  });

  it('lays bars out left to right without overlapping', () => {
    const { bars: drawn } = bars('38A509AC');

    for (let i = 1; i < drawn.length; i += 1) {
      const previousEnd = drawn[i - 1].x + drawn[i - 1].width;
      expect(drawn[i].x).toBeGreaterThanOrEqual(previousEnd);
    }
  });

  it('honours the wide-to-narrow ratio', () => {
    const { bars: narrowRatio } = bars('A', { narrow: 1, ratio: 2 });
    const { bars: wideRatio } = bars('A', { narrow: 1, ratio: 3 });

    expect(new Set(narrowRatio.map((b) => b.width))).toEqual(new Set([1, 2]));
    expect(new Set(wideRatio.map((b) => b.width))).toEqual(new Set([1, 3]));
  });

  it('encodes an empty payload as just the delimiters', () => {
    // A receipt for an order with an unexpected id should still print something
    // structurally valid rather than throwing during render.
    expect(() => bars('')).not.toThrow();
    expect(bars('').bars).toHaveLength(10);
  });
});

describe('toSvg', () => {
  it('produces an svg sized to its content', () => {
    const svg = toSvg('38A509AC', { height: 40 });

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 ');
    expect(svg).toContain('height="40"');
  });

  it('draws one rect per bar', () => {
    const value = '38A509AC';
    const rects = (toSvg(value).match(/<rect/g) ?? []).length;

    expect(rects).toBe(bars(value).bars.length);
  });

  it('renders crisply, because antialiased edges are what a scanner hesitates on', () => {
    expect(toSvg('38A509AC')).toContain('shape-rendering="crispEdges"');
  });

  it('names itself for assistive technology', () => {
    expect(toSvg('38A509AC')).toContain('aria-label="Barcode 38A509AC"');
  });

  it('is not a black rectangle', () => {
    // The regression this exists to prevent. The placeholder was one filled
    // shape spanning the whole width; a real symbol is many narrow ones.
    const { bars: drawn, width } = bars('38A509AC');

    expect(drawn.length).toBeGreaterThan(40);
    const inked = drawn.reduce((sum, bar) => sum + bar.width, 0);
    expect(inked).toBeLessThan(width * 0.75);
  });
});
