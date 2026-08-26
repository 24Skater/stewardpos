import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { matchesDeclaredType, verifiableTypes } from '../imageSignature';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF87 = Buffer.from('GIF87a', 'latin1');
const GIF89 = Buffer.from('GIF89a', 'latin1');
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP', 'latin1'),
]);
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00]);

describe('matchesDeclaredType', () => {
  it('accepts bytes that match the type they claim', () => {
    expect(matchesDeclaredType(PNG, 'image/png')).toBe(true);
    expect(matchesDeclaredType(JPEG, 'image/jpeg')).toBe(true);
    expect(matchesDeclaredType(JPEG, 'image/jpg')).toBe(true);
    expect(matchesDeclaredType(GIF87, 'image/gif')).toBe(true);
    expect(matchesDeclaredType(GIF89, 'image/gif')).toBe(true);
    expect(matchesDeclaredType(WEBP, 'image/webp')).toBe(true);
    expect(matchesDeclaredType(ICO, 'image/x-icon')).toBe(true);
    expect(matchesDeclaredType(ICO, 'image/vnd.microsoft.icon')).toBe(true);
  });

  it('refuses one image type wearing another type label', () => {
    // Not merely academic: the stored extension and the served Content-Type are
    // both chosen from the label, so a mislabelled-but-real image is still a
    // file the app describes incorrectly for the rest of its life.
    expect(matchesDeclaredType(PNG, 'image/gif')).toBe(false);
    expect(matchesDeclaredType(GIF89, 'image/png')).toBe(false);
    expect(matchesDeclaredType(JPEG, 'image/webp')).toBe(false);
  });

  it('refuses script and markup regardless of the label', () => {
    for (const payload of [
      'alert(document.domain)',
      '<html><script>1</script></html>',
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      '#!/bin/sh\nrm -rf /',
    ]) {
      expect(matchesDeclaredType(Buffer.from(payload), 'image/png')).toBe(false);
    }
  });

  it('refuses RIFF containers that are not WebP', () => {
    // RIFF alone is also .wav and .avi. Checking only the first four bytes
    // would let either through as an image.
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE', 'latin1'),
    ]);
    expect(matchesDeclaredType(wav, 'image/webp')).toBe(false);
  });

  it('refuses a CUR cursor claiming to be an icon', () => {
    // Byte 2 is the resource type: 1 is ICO, 2 is CUR.
    expect(matchesDeclaredType(Buffer.from([0x00, 0x00, 0x02, 0x00]), 'image/x-icon')).toBe(false);
  });

  it('refuses empty and truncated input rather than throwing', () => {
    expect(matchesDeclaredType(Buffer.alloc(0), 'image/png')).toBe(false);
    expect(matchesDeclaredType(Buffer.from([0x89]), 'image/png')).toBe(false);
    expect(matchesDeclaredType(PNG.subarray(0, 4), 'image/png')).toBe(false);
  });

  it('refuses a mimetype it has no test for', () => {
    // Fail closed. Reaching here with an unknown type means this table and the
    // route's allowlist have diverged, and storing the bytes anyway is the
    // wrong way to resolve that.
    expect(matchesDeclaredType(PNG, 'image/svg+xml')).toBe(false);
    expect(matchesDeclaredType(PNG, 'application/octet-stream')).toBe(false);
  });

  it('can verify every type the upload route accepts', () => {
    /**
     * The drift guard.
     *
     * Adding a mimetype to `ACCEPTED_IMAGE_TYPES` without adding a signature
     * here would make that type impossible to upload — `matchesDeclaredType`
     * fails closed, so the route would advertise support and refuse every file.
     * Read out of the source rather than duplicated, so the two cannot agree
     * in this test while disagreeing in production.
     */
    const source = readFileSync(path.join(__dirname, '..', 'upload.ts'), 'utf8');
    const block = source.slice(
      source.indexOf('const ACCEPTED_IMAGE_TYPES'),
      source.indexOf('};', source.indexOf('const ACCEPTED_IMAGE_TYPES'))
    );
    const accepted = [...block.matchAll(/'(image\/[a-z0-9.+-]+)':/g)].map((m) => m[1]);

    expect(accepted.length).toBeGreaterThan(0);
    expect(new Set(verifiableTypes())).toEqual(new Set(accepted));
  });
});
