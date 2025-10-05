import { DBPort } from '../core/ports/DBPort';
import { AuthPort } from '../core/ports/AuthPort';
import { EmailPort } from '../core/ports/EmailPort';
import { SmsPort } from '../core/ports/SmsPort';
import { StoragePort } from '../core/ports/StoragePort';
import { getConfig, AppConfig } from './config';

// Adapters
import { IndexedDBAdapter } from '../adapters/db/IndexedDBAdapter';
import { LocalAuthAdapter } from '../adapters/auth/LocalAuthAdapter';
import { ConsoleEmailAdapter } from '../adapters/email/ConsoleEmailAdapter';
import { ConsoleSmsAdapter } from '../adapters/sms/ConsoleSmsAdapter';
import { LocalStorageAdapter } from '../adapters/storage/LocalStorageAdapter';

class DIContainer {
  private static instance: DIContainer;
  private dbPort: DBPort | null = null;
  private authPort: AuthPort | null = null;
  private emailPort: EmailPort | null = null;
  private smsPort: SmsPort | null = null;
  private storagePort: StoragePort | null = null;
  private config: AppConfig;

  private constructor() {
    this.config = getConfig();
  }

  static getInstance(): DIContainer {
    if (!DIContainer.instance) {
      DIContainer.instance = new DIContainer();
    }
    return DIContainer.instance;
  }

  getDB(): DBPort {
    if (!this.dbPort) {
      switch (this.config.database.adapter) {
        case 'indexeddb':
          this.dbPort = new IndexedDBAdapter();
          break;
        case 'sqlite':
        case 'postgres':
          throw new Error(`Database adapter ${this.config.database.adapter} not yet implemented`);
        default:
          throw new Error(`Unknown database adapter: ${this.config.database.adapter}`);
      }
    }
    return this.dbPort;
  }

  getAuth(): AuthPort {
    if (!this.authPort) {
      switch (this.config.auth.adapter) {
        case 'local':
          this.authPort = new LocalAuthAdapter();
          break;
        case 'oidc':
        case 'google':
          throw new Error(`Auth adapter ${this.config.auth.adapter} not yet implemented`);
        default:
          throw new Error(`Unknown auth adapter: ${this.config.auth.adapter}`);
      }
    }
    return this.authPort;
  }

  getEmail(): EmailPort {
    if (!this.emailPort) {
      switch (this.config.email.adapter) {
        case 'console':
          this.emailPort = new ConsoleEmailAdapter();
          break;
        case 'smtp':
        case 'resend':
          throw new Error(`Email adapter ${this.config.email.adapter} not yet implemented`);
        default:
          throw new Error(`Unknown email adapter: ${this.config.email.adapter}`);
      }
    }
    return this.emailPort;
  }

  getSms(): SmsPort {
    if (!this.smsPort) {
      switch (this.config.sms.adapter) {
        case 'console':
          this.smsPort = new ConsoleSmsAdapter();
          break;
        case 'twilio':
          throw new Error(`SMS adapter ${this.config.sms.adapter} not yet implemented`);
        default:
          throw new Error(`Unknown SMS adapter: ${this.config.sms.adapter}`);
      }
    }
    return this.smsPort;
  }

  getStorage(): StoragePort {
    if (!this.storagePort) {
      switch (this.config.storage.adapter) {
        case 'localstorage':
          this.storagePort = new LocalStorageAdapter();
          break;
        case 's3':
        case 'azure':
          throw new Error(`Storage adapter ${this.config.storage.adapter} not yet implemented`);
        default:
          throw new Error(`Unknown storage adapter: ${this.config.storage.adapter}`);
      }
    }
    return this.storagePort;
  }

  getConfig(): AppConfig {
    return this.config;
  }

  reset(): void {
    this.dbPort = null;
    this.authPort = null;
    this.emailPort = null;
    this.smsPort = null;
    this.storagePort = null;
  }
}

// Export singleton instance methods
export const di = DIContainer.getInstance();
export const getDB = () => di.getDB();
export const getAuth = () => di.getAuth();
export const getEmail = () => di.getEmail();
export const getSms = () => di.getSms();
export const getStorage = () => di.getStorage();
export const getAppConfig = () => di.getConfig();
