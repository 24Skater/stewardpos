export interface StoragePort {
  put(key: string, data: Blob | File, metadata?: Record<string, any>): Promise<{ url: string; error?: Error }>;
  get(key: string): Promise<{ data: Blob | null; error?: Error }>;
  delete(key: string): Promise<{ success: boolean; error?: Error }>;
  getPublicUrl(key: string): string;
  isConfigured(): boolean;
  getProviderName(): string;
}
