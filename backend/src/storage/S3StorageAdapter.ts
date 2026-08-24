import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';
import type { StoragePort, StoredObject } from './StoragePort';
import { assertSafeKey } from './key';

export interface S3StorageConfig {
  bucket: string;
  region?: string;
  /** Set for MinIO or any other S3-compatible server; omit for AWS itself. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/** The error names S3 and MinIO use for "that object is not here". */
const NOT_FOUND = new Set(['NoSuchKey', 'NotFound', 'NoSuchBucket']);

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return (name !== undefined && NOT_FOUND.has(name)) || status === 404;
}

/**
 * Uploads in an S3 bucket, or anything that speaks S3 — MinIO included.
 *
 * Objects are addressed as `<prefix>/<filename>`, matching the layout the local
 * adapter uses on disk, so the same URL resolves under either and a migration is
 * a straight copy rather than a rename.
 *
 * Note what this deliberately does not do: it does not make the bucket public
 * and it does not hand out bucket URLs. Reads go back through the API, which
 * means the bucket can stay private, the browser never learns where the bucket
 * is, and switching adapters does not invalidate any URL already stored in the
 * database. The cost is that image bytes traverse the API process; for shop
 * logos and product photos behind a CDN-less single VPS that is not a real cost,
 * and it is the difference between a swappable port and a one-way door.
 */
export class S3StorageAdapter implements StoragePort {
  readonly name: string;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig, client?: S3Client) {
    this.bucket = config.bucket;
    this.name = config.endpoint ? `S3-compatible storage at ${config.endpoint}` : 'Amazon S3';
    this.client =
      client ??
      new S3Client({
        region: config.region ?? 'us-east-1',
        ...(config.endpoint
          ? {
              endpoint: config.endpoint,
              // MinIO serves buckets as a path, not a subdomain. Without this
              // the SDK builds `https://bucket.minio:9000/...`, which does not
              // resolve inside a Compose network and fails as a DNS error —
              // opaque enough to look like the container being down.
              forcePathStyle: true,
            }
          : {}),
        ...(config.accessKeyId && config.secretAccessKey
          ? {
              credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              },
            }
          : {}),
      });
  }

  private key(prefix: string, filename: string): string {
    assertSafeKey(prefix, filename);
    return `${prefix}/${filename}`;
  }

  async put(prefix: string, filename: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(prefix, filename),
        Body: body,
        ContentType: contentType,
      })
    );
  }

  async get(prefix: string, filename: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(prefix, filename) })
      );
      if (!result.Body) return null;
      return {
        body: result.Body as Readable,
        contentType: result.ContentType ?? 'application/octet-stream',
        contentLength: result.ContentLength,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async remove(prefix: string, filename: string): Promise<boolean> {
    const Key = this.key(prefix, filename);
    // DeleteObject succeeds whether or not the object existed, so the caller
    // could never tell a real delete from a no-op — and the route answers 404
    // on the second case. Hence the head first.
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key }));
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key }));
    return true;
  }

  async verify(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
