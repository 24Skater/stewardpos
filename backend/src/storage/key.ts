import path from 'path';
import { ValidationError } from '../utils/errors';

/**
 * Refuse any prefix or filename that is not a single plain path segment.
 *
 * `upload.ts` already validates the filename on the delete path, and derives it
 * from a uuid on the write path, so in normal operation nothing invalid reaches
 * a store. This exists because that is a statement about today's callers: the
 * port is a filesystem-shaped API, and every future caller of one of those is a
 * chance to reintroduce `../../../etc/passwd`. Enforcing it at the boundary
 * means the guarantee holds no matter who calls.
 *
 * S3 needs this as much as the local disk does. Keys there are opaque strings,
 * so `..` is not special and will not escape a bucket — but it does silently
 * produce an object whose key nothing else will ever construct, so a file
 * uploaded that way could not be read back or deleted. Same rule, same reason.
 */
export function assertSafeKey(prefix: string, filename: string): void {
  for (const [label, segment] of [
    ['prefix', prefix],
    ['filename', filename],
  ] as const) {
    if (
      !segment ||
      segment !== path.basename(segment) ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\') ||
      segment.includes('\0')
    ) {
      throw new ValidationError(`Invalid storage ${label}`);
    }
  }
}
