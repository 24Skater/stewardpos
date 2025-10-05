import { DBPort } from '../core/ports/DBPort';
import { AuthPort } from '../core/ports/AuthPort';
import { EmailPort } from '../core/ports/EmailPort';
import { SmsPort } from '../core/ports/SmsPort';
import { StoragePort } from '../core/ports/StoragePort';
import { getConfig, AppConfig } from './config';

// Adapters
import { IndexedDBAdapter } from '../adapters/db/IndexedDBAdapter';
import { PostgresAdapter } from '../adapters/db/PostgresAdapter';
import { LocalAuthAdapter } from '../adapters/auth/LocalAuthAdapter';
import { GoogleAuthAdapter } from '../adapters/auth/GoogleAuthAdapter';
import { OIDCAuthAdapter } from '../adapters/auth/OIDCAuthAdapter';
import { ConsoleEmailAdapter } from '../adapters/email/ConsoleEmailAdapter';
import { SMTPEmailAdapter } from '../adapters/email/SMTPEmailAdapter';
import { ResendEmailAdapter } from '../adapters/email/ResendEmailAdapter';
import { ConsoleSmsAdapter } from '../adapters/sms/ConsoleSmsAdapter';
import { TwilioSmsAdapter } from '../adapters/sms/TwilioSmsAdapter';
import { LocalStorageAdapter } from '../adapters/storage/LocalStorageAdapter';
import { S3StorageAdapter } from '../adapters/storage/S3StorageAdapter';
import { AzureBlobStorageAdapter } from '../adapters/storage/AzureBlobStorageAdapter';

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
        case 'postgres':
          if (!this.config.database.connection) {
            throw new Error('Postgres connection config is required');
          }
          this.dbPort = new PostgresAdapter({
            host: this.config.database.connection.host || 'localhost',
            port: this.config.database.connection.port || 5432,
            database: this.config.database.connection.database || 'persona_pos',
            user: this.config.database.connection.user || 'postgres',
            password: this.config.database.connection.password || '',
          });
          break;
        case 'sqlite':
          throw new Error('SQLite adapter not yet implemented');
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
        case 'google':
          if (!this.config.auth.config) {
            throw new Error('Google OAuth config is required');
          }
          this.authPort = new GoogleAuthAdapter({
            clientId: this.config.auth.config.clientId || '',
            clientSecret: this.config.auth.config.clientSecret || '',
            redirectUri: this.config.auth.config.redirectUri || window.location.origin + '/auth/callback',
          });
          break;
        case 'oidc':
          if (!this.config.auth.config) {
            throw new Error('OIDC config is required');
          }
          this.authPort = new OIDCAuthAdapter({
            issuer: this.config.auth.config.issuer || '',
            clientId: this.config.auth.config.clientId || '',
            clientSecret: this.config.auth.config.clientSecret || '',
            redirectUri: this.config.auth.config.redirectUri || window.location.origin + '/auth/callback',
          });
          break;
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
          if (!this.config.email.config) {
            throw new Error('SMTP config is required');
          }
          this.emailPort = new SMTPEmailAdapter({
            host: this.config.email.config.host || '',
            port: this.config.email.config.port || 587,
            secure: this.config.email.config.secure || false,
            user: this.config.email.config.user || '',
            password: this.config.email.config.password || '',
            from: this.config.email.from,
          });
          break;
        case 'resend':
          if (!this.config.email.config) {
            throw new Error('Resend config is required');
          }
          this.emailPort = new ResendEmailAdapter({
            apiKey: this.config.email.config.apiKey || '',
            from: this.config.email.from,
          });
          break;
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
          if (!this.config.sms.config) {
            throw new Error('Twilio config is required');
          }
          this.smsPort = new TwilioSmsAdapter({
            accountSid: this.config.sms.config.accountSid || '',
            authToken: this.config.sms.config.authToken || '',
            from: this.config.sms.from || '',
          });
          break;
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
          if (!this.config.storage.config) {
            throw new Error('S3 config is required');
          }
          this.storagePort = new S3StorageAdapter({
            endpoint: this.config.storage.config.endpoint || 'https://s3.amazonaws.com',
            region: this.config.storage.config.region || 'us-east-1',
            bucket: this.config.storage.config.bucket || '',
            accessKeyId: this.config.storage.config.accessKeyId || '',
            secretAccessKey: this.config.storage.config.secretAccessKey || '',
          });
          break;
        case 'azure':
          if (!this.config.storage.config) {
            throw new Error('Azure Blob config is required');
          }
          this.storagePort = new AzureBlobStorageAdapter({
            accountName: this.config.storage.config.accountName || '',
            accountKey: this.config.storage.config.accountKey || '',
            container: this.config.storage.config.bucket || 'assets',
          });
          break;
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
