/**
 * A store's brand colour, applied to the running app.
 *
 * `settings.brandColor` has been stored, validated and returned by the API since
 * the branding migration and has never been used by anything — a shop could pick
 * a colour, save it, and see no change anywhere. This is the piece that was
 * missing.
 *
 * The design system's tokens are plain hex custom properties (`--st-primary`
 * and friends), so applying a brand is a matter of overriding two of them on the
 * document root: the colour itself, and a foreground that stays readable on it.
 */

/** `#RRGGBB`. The API validates the same shape, so anything else is a bug here. */
const HEX = /^#([0-9A-Fa-f]{6})$/;

export function isBrandColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/**
 * Relative luminance, per WCAG.
 *
 * Used to decide whether text on the brand colour should be near-black or
 * near-white. Picking one and hoping is how a store that chooses a pale gold
 * ends up with white text on it: technically branded, practically unreadable,
 * and it is the colour behind every primary button in the app.
 */
export function relativeLuminance(hex: string): number {
  const match = HEX.exec(hex);
  if (!match) return 0;

  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(match[1].slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Contrast ratio between two hex colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** The design system's own near-black and near-white. */
const DARK_FG = '#0B1220';
const LIGHT_FG = '#FFFFFF';

/**
 * The more readable of the two foregrounds on a given background.
 *
 * Chosen by measured contrast rather than by a luminance threshold, because the
 * threshold that is right for one pair is wrong for another and this is the text
 * on every primary button in the app.
 */
export function readableForeground(background: string): string {
  return contrastRatio(background, DARK_FG) >= contrastRatio(background, LIGHT_FG)
    ? DARK_FG
    : LIGHT_FG;
}

/** The custom properties a brand colour overrides. */
export function brandProperties(color: string): Record<string, string> {
  return {
    '--st-primary': color,
    '--st-primaryFg': readableForeground(color),
    '--st-focusRing': color,
  };
}

/**
 * Apply a brand colour to a root element, or clear it.
 *
 * Clearing removes the properties rather than writing the default back, so the
 * stylesheet's own value — including whatever the dark theme sets — takes over
 * again. Writing a default would pin the app to the light theme's palette.
 */
export function applyBrandColor(color: string | null | undefined, root: HTMLElement): void {
  const properties = Object.keys(brandProperties('#000000'));

  if (!isBrandColor(color)) {
    for (const property of properties) root.style.removeProperty(property);
    return;
  }

  for (const [property, value] of Object.entries(brandProperties(color))) {
    root.style.setProperty(property, value);
  }
}

/**
 * Point the browser tab at the store's icon.
 *
 * The link element is created if the document has none, so this works on a page
 * whose head was never given a favicon to replace.
 */
export function applyFavicon(url: string | null | undefined, doc: Document): void {
  if (!url) return;

  let link = doc.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'icon';
    doc.head.appendChild(link);
  }

  link.href = url;
}
