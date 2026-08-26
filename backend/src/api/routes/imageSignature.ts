/**
 * Checking that an upload's bytes are the image type it claims to be.
 *
 * `file.mimetype` is not a fact about the file. multer copies it from the
 * caller's own `Content-Type` part header, so it says only what the uploader
 * asserted — a caller can send arbitrary bytes and label them `image/png`.
 *
 * The route's existing defences already make that survivable rather than fatal:
 * the stored extension is derived from the declared type instead of the
 * filename, SVG is refused outright, and `helmet()` sends
 * `X-Content-Type-Options: nosniff`, so a browser handed `Content-Type:
 * image/png` will not sniff its way to executing HTML inside it. This closes
 * the remaining gap rather than the whole hole: it stops the mislabelled bytes
 * being stored at all.
 *
 * That matters most for what happens to the file *later*. An image store is a
 * place things get read back by something other than a browser — a thumbnailer,
 * an image library, a backup that gets scanned, a CDN that does sniff. Each of
 * those is a decoder being handed a file whose type nobody ever verified.
 *
 * Magic numbers only. This is a cheap structural check on the first few bytes,
 * not validation that the image decodes; a truncated but correctly-signed PNG
 * still passes. Refusing what is obviously not an image is the goal, not
 * proving that what remains is a good one.
 */

/** How many leading bytes any check below needs. WebP's is the longest, at 12. */
const MAX_SIGNATURE_BYTES = 12;

function startsWith(buffer: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

/**
 * The signature test for each mimetype the upload route accepts.
 *
 * Keyed by exactly the mimetypes in `ACCEPTED_IMAGE_TYPES`, so a type added
 * there without a matching entry here fails the completeness test in
 * `__tests__/uploadSignature.test.ts` rather than silently skipping the check.
 */
const SIGNATURES: Record<string, (buffer: Buffer) => boolean> = {
  // \x89 P N G \r \n \x1a \n
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),

  // JPEG: SOI marker. The third byte is the first marker of the segment that
  // follows and varies by encoder (0xE0 JFIF, 0xE1 Exif, 0xDB raw tables), so
  // only the two-byte SOI is dependable.
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/jpg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),

  // GIF87a or GIF89a.
  'image/gif': (b) =>
    startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),

  // RIFF container with a WEBP fourcc at offset 8. Both halves are required:
  // RIFF alone is also .wav and .avi.
  'image/webp': (b) =>
    startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),

  // ICO: reserved 0x0000, then type 1. Type 2 is a CUR cursor, deliberately not
  // accepted - a favicon is an icon.
  'image/x-icon': (b) => startsWith(b, [0x00, 0x00, 0x01, 0x00]),
  'image/vnd.microsoft.icon': (b) => startsWith(b, [0x00, 0x00, 0x01, 0x00]),
};

/**
 * Whether `buffer` really is an image of type `mimetype`.
 *
 * An unknown mimetype returns false rather than true. The route's own allowlist
 * has already rejected anything unknown by the time this runs, so reaching here
 * with one means the two lists have diverged — and the safe reading of "I have
 * no test for this" is "do not store it".
 */
export function matchesDeclaredType(buffer: Buffer, mimetype: string): boolean {
  const check = SIGNATURES[mimetype];
  if (!check) return false;
  if (buffer.length < 2) return false;
  return check(buffer.subarray(0, MAX_SIGNATURE_BYTES));
}

/** The mimetypes this module can vouch for. Used by the completeness test. */
export function verifiableTypes(): string[] {
  return Object.keys(SIGNATURES);
}
