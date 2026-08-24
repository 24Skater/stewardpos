import type { Readable } from 'stream';

/**
 * The kinds of upload the app knows about.
 *
 * A kind is not a directory name — it is a bucket-agnostic namespace that each
 * adapter maps onto its own storage. `upload.ts` owns the table of which
 * permission each kind needs; this only says where the bytes go.
 */
export type UploadKind = 'logo' | 'icon' | 'favicon' | 'product';

/** What a stored object looks like when it is read back. */
export interface StoredObject {
  body: Readable;
  contentType: string;
  contentLength?: number;
}

/**
 * Where uploaded files live.
 *
 * Deliberately narrow: put bytes, read bytes back, remove them, and say whether
 * something is there. Anything richer (signed URLs, lifecycle rules, copies)
 * would only be implementable by one adapter, and a port that only one
 * implementation can satisfy is not a port.
 *
 * **URLs are not part of this interface, on purpose.** Every upload is addressed
 * as `/uploads/<prefix>/<filename>` regardless of adapter, and the API serves
 * that path by streaming from whichever adapter is configured. Handing out
 * bucket URLs instead would have made the stored URL depend on the adapter that
 * happened to be active when the file was uploaded — so switching adapters, or
 * moving a bucket, would break every image already referenced from
 * `settings.logo_url` and `products.image_url`. A relative path outlives all of
 * that, and keeps working behind a reverse proxy on any domain.
 */
export interface StoragePort {
  /** Human-readable name of the backing store, for logs and the health probe. */
  readonly name: string;

  /** Store `body` under `prefix/filename`, overwriting any existing object. */
  put(prefix: string, filename: string, body: Buffer, contentType: string): Promise<void>;

  /** Read an object back, or `null` if it is not there. */
  get(prefix: string, filename: string): Promise<StoredObject | null>;

  /** Remove an object. Resolves `false` if there was nothing to remove. */
  remove(prefix: string, filename: string): Promise<boolean>;

  /**
   * Check the store is reachable and writable.
   *
   * Called at boot so a misconfigured bucket is a startup failure rather than a
   * 500 the first time somebody changes a logo.
   */
  verify(): Promise<void>;
}

/**
 * Raised when an adapter is selected but cannot be built from the configuration
 * given.
 *
 * Mirrors `TerminalNotConfiguredError`: the operator picked something and left
 * out a required part of it, which is a fixable mistake and should read as one
 * rather than as the server being broken.
 */
export class StorageNotConfiguredError extends Error {
  constructor(adapter: string, missing: string) {
    super(
      `STORAGE_ADAPTER is set to "${adapter}", but ${missing} is not configured. ` +
        'Set it, or switch STORAGE_ADAPTER back to "localstorage".'
    );
    this.name = 'StorageNotConfiguredError';
  }
}
