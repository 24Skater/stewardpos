import path from 'path';
import config from '../config';
import logger from '../utils/logger';
import type { StoragePort } from './StoragePort';
import { StorageNotConfiguredError } from './StoragePort';
import { LocalStorageAdapter } from './LocalStorageAdapter';
import { S3StorageAdapter } from './S3StorageAdapter';

export type { StoragePort, StoredObject, UploadKind } from './StoragePort';
export { StorageNotConfiguredError } from './StoragePort';
export { LocalStorageAdapter } from './LocalStorageAdapter';
export { S3StorageAdapter } from './S3StorageAdapter';

/** Where the local adapter keeps files, and what a bind mount should target. */
export const LOCAL_UPLOAD_ROOT = path.join(process.cwd(), 'uploads');

function required(value: string | undefined, adapter: string, missing: string): string {
  if (!value) throw new StorageNotConfiguredError(adapter, missing);
  return value;
}

export function createStorageAdapter(
  storage: typeof config.storage = config.storage
): StoragePort {
  switch (storage.adapter) {
    case 's3':
      return new S3StorageAdapter({
        bucket: required(storage.s3?.bucket, 's3', 'S3_BUCKET'),
        region: storage.s3?.region,
        endpoint: storage.s3?.endpoint,
        accessKeyId: storage.s3?.accessKeyId,
        secretAccessKey: storage.s3?.secretAccessKey,
      });
    case 'localstorage':
    default:
      return new LocalStorageAdapter(LOCAL_UPLOAD_ROOT);
  }
}

let current: StoragePort | null = null;

/**
 * The store the app is using.
 *
 * Built once and reused: the S3 client holds a connection pool, and rebuilding
 * it per request would open a socket per upload.
 */
export function storage(): StoragePort {
  current ??= createStorageAdapter();
  return current;
}

/** Test seam — lets a suite install a stand-in without touching the config. */
export function setStorageAdapter(adapter: StoragePort | null): void {
  current = adapter;
}

/**
 * Prove the configured store works before the server starts accepting traffic.
 *
 * A bad bucket name or a read-only volume is a configuration mistake, and the
 * useful moment to report one is at boot with the operator watching, not on
 * whatever request happens to be the first to change a logo.
 */
export async function verifyStorage(): Promise<void> {
  const store = storage();
  await store.verify();
  logger.info(`Uploads are stored in ${store.name}`);
}
