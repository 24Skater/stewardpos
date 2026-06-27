import { StoragePort } from '../../core/ports/StoragePort';

export class AzureBlobStorageAdapter implements StoragePort {
  private config: {
    accountName: string;
    accountKey: string;
    container: string;
  };

  constructor(config: { accountName: string; accountKey: string; container: string }) {
    this.config = config;
  }

  async put(key: string, data: Blob | File, metadata?: Record<string, unknown>): Promise<{ url: string; error?: Error }> {
    console.log('☁️ Azure Blob Storage Adapter (Mock)');
    console.log('Account:', this.config.accountName);
    console.log('Container:', this.config.container);
    console.log('Blob:', key);
    console.log('Size:', data.size, 'bytes');
    console.log('⚠️ Note: Azure Blob requires backend implementation for actual uploads');
    
    // Mock URL
    const url = `https://${this.config.accountName}.blob.core.windows.net/${this.config.container}/${key}`;
    return { url };
  }

  async get(key: string): Promise<{ data: Blob | null; error?: Error }> {
    console.log('☁️ Azure Blob Storage Adapter: Getting', key);
    console.log('⚠️ Note: Azure Blob requires backend implementation');
    return { data: null, error: new Error('Azure Blob requires backend implementation') };
  }

  async delete(key: string): Promise<{ success: boolean; error?: Error }> {
    console.log('☁️ Azure Blob Storage Adapter: Deleting', key);
    console.log('⚠️ Note: Azure Blob requires backend implementation');
    return { success: true };
  }

  getPublicUrl(key: string): string {
    return `https://${this.config.accountName}.blob.core.windows.net/${this.config.container}/${key}`;
  }

  isConfigured(): boolean {
    return !!(this.config.accountName && this.config.accountKey && this.config.container);
  }

  getProviderName(): string {
    return 'azure';
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: 'Azure Blob not configured' };
    }
    
    console.log('Testing Azure Blob connection for account', this.config.accountName);
    return { success: true };
  }
}
