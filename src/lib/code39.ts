/**
 * Code 39 barcodes, as SVG.
 *
 * The receipt printed a solid black rectangle with the class name
 * `barcode-placeholder` and the text `*38A509AC*` beneath it. A placeholder that
 * ships is just a wrong picture: it costs the same ink, occupies the same space,
 * and cannot be scanned — so the returns desk types the order id by hand off a
 * receipt that appears to carry a barcode.
 *
 * Code 39 rather than a denser symbology because it is what the receipt was
 * already pretending to be (the `*` delimiters are its start and stop
 * characters), it needs no check digit, every handheld scanner reads it, and it
 * encodes the uppercase hex of an order id directly.
 *
 * Written out rather than pulled in: this is one lookup table and some
 * arithmetic, against a dependency in the bundle every till downloads.
 */

/**
 * Each character is nine elements — five bars and four spaces, alternating and
 * starting with a bar — of which exactly three are wide.
 *
 * `n` narrow, `w` wide. The table is verified structurally in the tests rather
 * than by eye: a transcription slip here produces a barcode that scans as the
 * wrong thing, which is worse than one that does not scan at all.
 */
const PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw',
  E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn',
  I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww',
  M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn',
  Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn', Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn',
  '*': 'nwnnwnwnn',
};

/*
 * Space, `$`, `/`, `+` and `%` are deliberately absent.
 *
 * Code 39 defines them, and they are the five characters whose patterns do not
 * follow the two-wide-bars-and-one-wide-space shape every other character has.
 * That makes them the easiest to transcribe wrongly and the hardest to verify
 * without a scanner — and a mis-transcribed barcode does not look broken, it
 * scans cleanly as the wrong value.
 *
 * Nothing here needs them: this encodes order ids, which are uppercase hex. The
 * characters that are present all share one structural invariant, which the
 * tests assert uniformly, so a typo in this table cannot pass.
 */

/** The delimiter Code 39 requires at both ends. */
const DELIMITER = '*';

export const CODE39_PATTERNS: Readonly<Record<string, string>> = PATTERNS;

/** Characters Code 39 can carry. Anything else has to be dropped or refused. */
export function isEncodable(value: string): boolean {
  return [...value.toUpperCase()].every((character) => character in PATTERNS && character !== DELIMITER);
}

/**
 * Strip what cannot be encoded rather than refusing outright.
 *
 * A receipt with a barcode of the encodable part is more useful than a receipt
 * with an error on it, and order ids are hex — this only ever fires if the
 * caller passes something unexpected.
 */
export function sanitize(value: string): string {
  return [...value.toUpperCase()].filter((c) => c in PATTERNS && c !== DELIMITER).join('');
}

export interface BarcodeOptions {
  /** Width of a narrow element, in user units. */
  narrow?: number;
  /** How many narrow widths a wide element spans. Code 39 permits 2 to 3. */
  ratio?: number;
  height?: number;
}

interface Bar {
  x: number;
  width: number;
}

/**
 * The dark bars of the symbol, with the total width they occupy.
 *
 * Returned as geometry rather than markup so the same computation serves the
 * React component and the print document, and so it can be tested without
 * parsing SVG.
 */
export function bars(value: string, options: BarcodeOptions = {}): { bars: Bar[]; width: number } {
  const narrow = options.narrow ?? 2;
  const ratio = options.ratio ?? 3;
  const wide = narrow * ratio;

  const text = `${DELIMITER}${sanitize(value)}${DELIMITER}`;
  const out: Bar[] = [];
  let x = 0;

  for (let index = 0; index < text.length; index += 1) {
    const pattern = PATTERNS[text[index]];

    for (let element = 0; element < pattern.length; element += 1) {
      const width = pattern[element] === 'w' ? wide : narrow;
      // Even elements are bars, odd are spaces; only bars are drawn.
      if (element % 2 === 0) out.push({ x, width });
      x += width;
    }

    // Code 39 separates characters by one narrow space, and does not add one
    // after the last character.
    if (index < text.length - 1) x += narrow;
  }

  return { bars: out, width: x };
}

/**
 * A complete `<svg>` element as a string.
 *
 * A string because the receipt's print view is assembled as HTML text and
 * handed to a print window; the React component below renders the same geometry
 * as elements.
 */
export function toSvg(value: string, options: BarcodeOptions = {}): string {
  const height = options.height ?? 40;
  const { bars: drawn, width } = bars(value, options);

  const rects = drawn
    .map((bar) => `<rect x="${bar.x}" y="0" width="${bar.width}" height="${height}" fill="#000"/>`)
    .join('');

  // `shape-rendering="crispEdges"` matters on a thermal printer and on a
  // low-DPI screen: antialiased bar edges are what makes a scanner hesitate.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}" shape-rendering="crispEdges" role="img" ` +
    `aria-label="Barcode ${sanitize(value)}">${rects}</svg>`
  );
}
