import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyBrandColor,
  applyFavicon,
  brandProperties,
  contrastRatio,
  isBrandColor,
  readableForeground,
  relativeLuminance,
} from '../brand-theme';

/**
 * Applying a store's brand.
 *
 * `brandColor` was stored, validated by the API and returned on every settings
 * read, and nothing in the app had ever looked at it — a shop could pick a
 * colour, save it, reload, and see no difference. These cover the piece that
 * makes the setting mean something, and in particular the contrast rule: the
 * brand colour sits behind every primary button, so choosing the wrong text
 * colour on it is not cosmetic.
 */
describe('isBrandColor', () => {
  it('accepts a six-digit hex', () => {
    expect(isBrandColor('#E8B847')).toBe(true);
    expect(isBrandColor('#000000')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isBrandColor('#FFF')).toBe(false);
    expect(isBrandColor('rebeccapurple')).toBe(false);
    expect(isBrandColor('')).toBe(false);
    expect(isBrandColor(undefined)).toBe(false);
    expect(isBrandColor(null)).toBe(false);
  });
});

describe('relativeLuminance', () => {
  it('puts black at zero and white at one', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });
});

describe('contrastRatio', () => {
  it('gives the known extremes', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });

  it('does not depend on the order of its arguments', () => {
    expect(contrastRatio('#E8B847', '#0B1220')).toBeCloseTo(
      contrastRatio('#0B1220', '#E8B847'),
      5
    );
  });
});

describe('readableForeground', () => {
  it('puts dark text on a pale brand', () => {
    // The default gold. White on it is roughly 1.9:1 — unreadable, and it is the
    // text on every primary button in the app.
    expect(readableForeground('#E8B847')).toBe('#0B1220');
    expect(readableForeground('#FFFFFF')).toBe('#0B1220');
  });

  it('puts light text on a dark brand', () => {
    expect(readableForeground('#0B1220')).toBe('#FFFFFF');
    expect(readableForeground('#1B2A41')).toBe('#FFFFFF');
  });

  it('always clears the 4.5:1 bar for normal text', () => {
    for (const color of ['#E8B847', '#1B2A41', '#DC2626', '#16A34A', '#2563EB', '#808080']) {
      expect(contrastRatio(color, readableForeground(color))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('applyBrandColor', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
  });

  it('sets the colour and a readable foreground', () => {
    applyBrandColor('#1B2A41', root);

    expect(root.style.getPropertyValue('--st-primary')).toBe('#1B2A41');
    expect(root.style.getPropertyValue('--st-primaryFg')).toBe('#FFFFFF');
  });

  it('removes the overrides rather than writing a default back', () => {
    // Writing the light theme's gold back would pin a dark-themed install to the
    // light palette; removing lets the stylesheet's own value take over again.
    applyBrandColor('#1B2A41', root);
    applyBrandColor(null, root);

    expect(root.style.getPropertyValue('--st-primary')).toBe('');
    expect(root.style.getPropertyValue('--st-primaryFg')).toBe('');
  });

  it('ignores a malformed colour instead of writing it into the theme', () => {
    applyBrandColor('#1B2A41', root);
    applyBrandColor('not a colour', root);

    expect(root.style.getPropertyValue('--st-primary')).toBe('');
  });

  it('themes the focus ring too, so keyboard focus stays on brand', () => {
    expect(Object.keys(brandProperties('#1B2A41'))).toContain('--st-focusRing');
  });
});

describe('applyFavicon', () => {
  beforeEach(() => {
    document.head.querySelectorAll("link[rel~='icon']").forEach((link) => link.remove());
  });

  it('creates the link when the document has none', () => {
    applyFavicon('/uploads/icon.png', document);

    expect(document.querySelector<HTMLLinkElement>("link[rel~='icon']")?.href).toContain(
      '/uploads/icon.png'
    );
  });

  it('replaces an existing one rather than adding a second', () => {
    applyFavicon('/uploads/one.png', document);
    applyFavicon('/uploads/two.png', document);

    const links = document.querySelectorAll("link[rel~='icon']");
    expect(links).toHaveLength(1);
    expect((links[0] as HTMLLinkElement).href).toContain('two.png');
  });

  it('leaves the tab alone when no icon is configured', () => {
    applyFavicon(undefined, document);

    expect(document.querySelector("link[rel~='icon']")).toBeNull();
  });
});
