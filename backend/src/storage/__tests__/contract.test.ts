import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Readable } from 'stream';
import type { StoragePort } from '../StoragePort';
import { LocalStorageAdapter } from '../LocalStorageAdapter';
import { S3StorageAdapter } from '../S3StorageAdapter';

async function drain(body: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * One suite, run against every adapter.
 *
 * The point of a port is that callers cannot tell which implementation they
 * have. Testing each adapter against its own bespoke expectations would let the
 * two drift into behaving differently for the same call — which is exactly the
 * failure that only shows up after someone flips `STORAGE_ADAPTER` in
 * production. So the expectations live here, once.
 */
function behavesLikeAStore(name: string, makeStore: () => StoragePort) {
  describe(name, () => {
    let store: StoragePort;
    beforeEach(() => {
      store = makeStore();
    });

    it('reads back exactly what was written', async () => {
      await store.put('logos', 'a.png', Buffer.from('bytes'), 'image/png');

      const found = await store.get('logos', 'a.png');

      expect(found).not.toBeNull();
      expect(await drain(found!.body)).toBe('bytes');
    });

    it('preserves the content type it was given', async () => {
      await store.put('icons', 'b.ico', Buffer.from('x'), 'image/x-icon');

      const found = await store.get('icons', 'b.ico');

      expect(found!.contentType).toBe('image/x-icon');
      // Drain it. `get` hands back an open handle, and leaving one dangling
      // while the temp directory is removed surfaces as an unhandled ENOENT
      // attributed to whichever test happens to be running at the time.
      await drain(found!.body);
    });

    it('resolves null for an object that is not there, rather than throwing', async () => {
      expect(await store.get('logos', 'absent.png')).toBeNull();
    });

    it('keeps prefixes separate, so the same name in two kinds is two objects', async () => {
      await store.put('logos', 'same.png', Buffer.from('the logo'), 'image/png');
      await store.put('products', 'same.png', Buffer.from('the product'), 'image/png');

      expect(await drain((await store.get('logos', 'same.png'))!.body)).toBe('the logo');
      expect(await drain((await store.get('products', 'same.png'))!.body)).toBe('the product');
    });

    it('overwrites on a repeated put', async () => {
      await store.put('logos', 'c.png', Buffer.from('first'), 'image/png');
      await store.put('logos', 'c.png', Buffer.from('second'), 'image/png');

      expect(await drain((await store.get('logos', 'c.png'))!.body)).toBe('second');
    });

    it('reports whether remove actually removed something', async () => {
      await store.put('logos', 'd.png', Buffer.from('x'), 'image/png');

      expect(await store.remove('logos', 'd.png')).toBe(true);
      expect(await store.remove('logos', 'd.png')).toBe(false);
      expect(await store.get('logos', 'd.png')).toBeNull();
    });

    // The route guards against traversal before it reaches the store, but a
    // second line of defence belongs here: an adapter is a filesystem-shaped
    // API and this is the mistake filesystem-shaped APIs make.
    it.each([
      ['..', 'passwd'],
      ['logos', '../../../etc/passwd'],
      ['logos', 'a/b.png'],
      ['../logos', 'a.png'],
    ])('refuses a key that escapes its prefix (%s / %s)', async (prefix, filename) => {
      await expect(store.put(prefix, filename, Buffer.from('x'), 'image/png')).rejects.toThrow(
        /invalid/i
      );
    });
  });
}

// ── Local ──────────────────────────────────────────────────────────────────
let tmpRoot: string;
behavesLikeAStore('LocalStorageAdapter', () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stewardpos-storage-'));
  return new LocalStorageAdapter(tmpRoot);
});
afterEach(() => {
  if (tmpRoot && fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── S3, against an in-memory stand-in for the bucket ───────────────────────
/**
 * A fake S3 client rather than a mocked adapter.
 *
 * Mocking the adapter would make the contract suite tautological — it would
 * assert that the mock does what the mock was told to do. This substitutes the
 * SDK client at its own seam, so the adapter's real command construction, key
 * building and error mapping are all exercised.
 */
class FakeS3Client {
  objects = new Map<string, { body: Buffer; contentType: string }>();

  async send(command: { __type: string; input: Record<string, unknown> }) {
    const key = command.input.Key as string;
    switch (command.__type) {
      case 'PutObject':
        this.objects.set(key, {
          body: command.input.Body as Buffer,
          contentType: command.input.ContentType as string,
        });
        return {};
      case 'GetObject': {
        const found = this.objects.get(key);
        if (!found) {
          const err = new Error('NoSuchKey') as Error & { name: string };
          err.name = 'NoSuchKey';
          throw err;
        }
        const { Readable: R } = await import('stream');
        return {
          Body: R.from([found.body]),
          ContentType: found.contentType,
          ContentLength: found.body.length,
        };
      }
      case 'HeadObject':
        if (!this.objects.has(key)) {
          const err = new Error('NotFound') as Error & { name: string };
          err.name = 'NotFound';
          throw err;
        }
        return {};
      case 'DeleteObject':
        this.objects.delete(key);
        return {};
      case 'HeadBucket':
        return {};
      default:
        throw new Error(`FakeS3Client got an unexpected command: ${command.__type}`);
    }
  }
}

vi.mock('@aws-sdk/client-s3', () => {
  const tag = (__type: string) =>
    class {
      __type = __type;
      input: Record<string, unknown>;
      constructor(input: Record<string, unknown>) {
        this.input = input;
      }
    };
  return {
    S3Client: class {},
    PutObjectCommand: tag('PutObject'),
    GetObjectCommand: tag('GetObject'),
    HeadObjectCommand: tag('HeadObject'),
    DeleteObjectCommand: tag('DeleteObject'),
    HeadBucketCommand: tag('HeadBucket'),
  };
});

behavesLikeAStore('S3StorageAdapter', () => {
  const fake = new FakeS3Client();
  return new S3StorageAdapter(
    { bucket: 'stewardpos', region: 'us-east-1' },
    fake as unknown as ConstructorParameters<typeof S3StorageAdapter>[1]
  );
});
