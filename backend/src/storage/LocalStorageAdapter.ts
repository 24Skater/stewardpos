import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import type { StoragePort, StoredObject } from './StoragePort';
import { assertSafeKey } from './key';

/**
 * Uploads on the machine running the API, under a root directory.
 *
 * This is the default and, for a single-backend install, the right answer: a
 * Docker volume is simpler to back up than a bucket and has no credentials to
 * leak. It stops being the right answer the moment there is a second backend
 * replica, because a file written by one is invisible to the other.
 *
 * The content type is not stored alongside the bytes. It is derived from the
 * extension on read, which is sound here because the extension is chosen by the
 * server from the accepted-types table — never taken from the upload — so it
 * cannot disagree with what was actually written.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

export class LocalStorageAdapter implements StoragePort {
  readonly name = 'local disk';

  constructor(private readonly root: string) {}

  private resolve(prefix: string, filename: string): string {
    assertSafeKey(prefix, filename);
    return path.join(this.root, prefix, filename);
  }

  async put(prefix: string, filename: string, body: Buffer, _contentType: string): Promise<void> {
    const target = this.resolve(prefix, filename);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, body);
  }

  async get(prefix: string, filename: string): Promise<StoredObject | null> {
    const target = this.resolve(prefix, filename);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(target);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;
    return {
      body: createReadStream(target),
      contentType: CONTENT_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      contentLength: stat.size,
    };
  }

  async remove(prefix: string, filename: string): Promise<boolean> {
    const target = this.resolve(prefix, filename);
    try {
      await fs.promises.unlink(target);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async verify(): Promise<void> {
    await fs.promises.mkdir(this.root, { recursive: true });
    // Writable, not merely present: a volume mounted read-only, or owned by
    // another uid, passes an existence check and then fails on the first logo
    // change. Better to find out at boot.
    await fs.promises.access(this.root, fs.constants.W_OK);
  }
}
