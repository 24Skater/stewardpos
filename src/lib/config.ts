import { z } from 'zod';

const configSchema = z.object({
  database: z.object({
    adapter: z.enum(['indexeddb', 'sqlite', 'postgres']).default('indexeddb'),
    connection: z.object({
      host: z.string().optional(),
      port: z.number().optional(),
      database: z.string().optional(),
      user: z.string().optional(),
      password: z.string().optional(),
      filename: z.string().optional(), // for SQLite
    }).optional(),
  }),
  auth: z.object({
    adapter: z.enum(['local', 'oidc', 'google']).default('local'),
    sessionDuration: z.number().default(86400000), // 24 hours in ms
    config: z.object({
      issuer: z.string().optional(),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      redirectUri: z.string().optional(),
    }).optional(),
  }),
  email: z.object({
    adapter: z.enum(['console', 'smtp', 'resend']).default('console'),
    from: z.string().default('noreply@example.com'),
    config: z.object({
      host: z.string().optional(),
      port: z.number().optional(),
      secure: z.boolean().optional(),
      user: z.string().optional(),
      password: z.string().optional(),
      apiKey: z.string().optional(), // for Resend
    }).optional(),
  }),
  sms: z.object({
    adapter: z.enum(['console', 'twilio']).default('console'),
    from: z.string().optional(),
    config: z.object({
      accountSid: z.string().optional(),
      authToken: z.string().optional(),
    }).optional(),
  }),
  storage: z.object({
    adapter: z.enum(['localstorage', 's3', 'azure']).default('localstorage'),
    config: z.object({
      bucket: z.string().optional(),
      region: z.string().optional(),
      endpoint: z.string().optional(),
      accessKeyId: z.string().optional(),
      secretAccessKey: z.string().optional(),
      accountName: z.string().optional(),
      accountKey: z.string().optional(),
    }).optional(),
  }),
  features: z.object({
    reports: z.boolean().default(true),
    email: z.boolean().default(false),
    sms: z.boolean().default(false),
    sso: z.boolean().default(false),
    storage: z.boolean().default(true),
  }),
  app: z.object({
    name: z.string().default('Persona POS'),
    environment: z.enum(['development', 'production']).default('development'),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;

// Default configuration
const defaultConfig: AppConfig = {
  database: {
    adapter: 'indexeddb',
  },
  auth: {
    adapter: 'local',
    sessionDuration: 86400000,
  },
  email: {
    adapter: 'console',
    from: 'noreply@example.com',
  },
  sms: {
    adapter: 'console',
  },
  storage: {
    adapter: 'localstorage',
  },
  features: {
    reports: true,
    email: false,
    sms: false,
    sso: false,
    storage: true,
  },
  app: {
    name: 'Persona POS',
    environment: 'development',
  },
};

// Environment variable mapping
function getConfigFromEnv(): Partial<AppConfig> {
  const envConfig: any = {};

  // Database
  if (import.meta.env.VITE_DB_ADAPTER) {
    envConfig.database = { adapter: import.meta.env.VITE_DB_ADAPTER };
  }

  // Auth
  if (import.meta.env.VITE_AUTH_ADAPTER) {
    envConfig.auth = { 
      adapter: import.meta.env.VITE_AUTH_ADAPTER,
      sessionDuration: import.meta.env.VITE_AUTH_SESSION_DURATION 
        ? parseInt(import.meta.env.VITE_AUTH_SESSION_DURATION) 
        : undefined,
    };
  }

  // Email
  if (import.meta.env.VITE_EMAIL_ADAPTER) {
    envConfig.email = {
      adapter: import.meta.env.VITE_EMAIL_ADAPTER,
      from: import.meta.env.VITE_EMAIL_FROM,
    };
  }

  // SMS
  if (import.meta.env.VITE_SMS_ADAPTER) {
    envConfig.sms = {
      adapter: import.meta.env.VITE_SMS_ADAPTER,
      from: import.meta.env.VITE_SMS_FROM,
    };
  }

  // Storage
  if (import.meta.env.VITE_STORAGE_ADAPTER) {
    envConfig.storage = { adapter: import.meta.env.VITE_STORAGE_ADAPTER };
  }

  // Features
  const features: any = {};
  if (import.meta.env.VITE_FEATURE_REPORTS !== undefined) {
    features.reports = import.meta.env.VITE_FEATURE_REPORTS === 'true';
  }
  if (import.meta.env.VITE_FEATURE_EMAIL !== undefined) {
    features.email = import.meta.env.VITE_FEATURE_EMAIL === 'true';
  }
  if (import.meta.env.VITE_FEATURE_SMS !== undefined) {
    features.sms = import.meta.env.VITE_FEATURE_SMS === 'true';
  }
  if (import.meta.env.VITE_FEATURE_SSO !== undefined) {
    features.sso = import.meta.env.VITE_FEATURE_SSO === 'true';
  }
  if (Object.keys(features).length > 0) {
    envConfig.features = features;
  }

  return envConfig;
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const envConfig = getConfigFromEnv();
  const mergedConfig = {
    ...defaultConfig,
    ...envConfig,
    database: { ...defaultConfig.database, ...envConfig.database },
    auth: { ...defaultConfig.auth, ...envConfig.auth },
    email: { ...defaultConfig.email, ...envConfig.email },
    sms: { ...defaultConfig.sms, ...envConfig.sms },
    storage: { ...defaultConfig.storage, ...envConfig.storage },
    features: { ...defaultConfig.features, ...envConfig.features },
    app: { ...defaultConfig.app, ...envConfig.app },
  };

  cachedConfig = configSchema.parse(mergedConfig);
  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}
