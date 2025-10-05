import { StoragePort } from '../../core/ports/StoragePort';

export class S3StorageAdapter implements StoragePort {
  private config: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };

  constructor(config: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) {
    this.config = config;
  }

  async put(key: string, data: Blob | File, metadata?: Record<string, any>): Promise<{ url: string; error?: Error }> {
    console.log('☁️ S3 Storage Adapter (Mock)');
    console.log('Bucket:', this.config.bucket);
    console.log('Key:', key);
    console.log('Size:', data.size, 'bytes');
    console.log('⚠️ Note: S3 requires backend implementation for actual uploads');
    
    // Mock URL
    const url = `${this.config.endpoint}/${this.config.bucket}/${key}`;
    return { url };
  }

  async get(key: string): Promise<{ data: Blob | null; error?: Error }> {
    console.log('☁️ S3 Storage Adapter: Getting', key);
    console.log('⚠️ Note: S3 requires backend implementation');
    return { data: null, error: new Error('S3 requires backend implementation') };
  }

  async delete(key: string): Promise<{ success: boolean; error?: Error }> {
    console.log('☁️ S3 Storage Adapter: Deleting', key);
    console.log('⚠️ Note: S3 requires backend implementation');
    return { success: true };
  }

  getPublicUrl(key: string): string {
    return `${this.config.endpoint}/${this.config.bucket}/${key}`;
  }

  isConfigured(): boolean {
    return !!(
      this.config.endpoint &&
      this.config.bucket &&
      this.config.accessKeyId &&
      this.config.secretAccessKey
    );
  }

  getProviderName(): string {
    return 's3';
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: 'S3 not configured' };
    }
    
    console.log('Testing S3 connection to', this.config.endpoint);
    return { success: true };
  }
}
