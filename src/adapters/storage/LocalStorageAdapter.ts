import { StoragePort } from '../../core/ports/StoragePort';

export class LocalStorageAdapter implements StoragePort {
  private readonly prefix = 'persona-pos-storage';

  async put(key: string, data: Blob | File, metadata?: Record<string, unknown>): Promise<{ url: string; error?: Error }> {
    try {
      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(data);
      });

      const storageKey = `${this.prefix}:${key}`;
      const storageValue = JSON.stringify({
        data: base64Data,
        metadata: metadata || {},
        timestamp: Date.now(),
      });

      localStorage.setItem(storageKey, storageValue);

      return { url: this.getPublicUrl(key) };
    } catch (error) {
      return { url: '', error: error as Error };
    }
  }

  async get(key: string): Promise<{ data: Blob | null; error?: Error }> {
    try {
      const storageKey = `${this.prefix}:${key}`;
      const stored = localStorage.getItem(storageKey);

      if (!stored) {
        return { data: null };
      }

      const parsed = JSON.parse(stored);
      const response = await fetch(parsed.data);
      const blob = await response.blob();

      return { data: blob };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  async delete(key: string): Promise<{ success: boolean; error?: Error }> {
    try {
      const storageKey = `${this.prefix}:${key}`;
      localStorage.removeItem(storageKey);
      return { success: true };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  }

  getPublicUrl(key: string): string {
    // Return a data URL or reference
    return `localstorage://${key}`;
  }

  isConfigured(): boolean {
    return true;
  }

  getProviderName(): string {
    return 'localstorage';
  }
}
