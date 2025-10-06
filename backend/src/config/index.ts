import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Configuration schema
const configSchema = z.object({
  // Server
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3000),
  host: z.string().default('0.0.0.0'),

  // Database
  database: z.object({
    adapter: z.enum(['postgres', 'sqlite']),
    host: z.string().optional(),
    port: z.coerce.number().optional(),
    name: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    filename: z.string().optional(),
  }),

  // JWT
  jwt: z.object({
    secret: z.string().min(32),
    expiresIn: z.string().default('24h'),
  }),

  // CORS
  cors: z.object({
    origin: z.string().default('http://localhost:8080'),
  }),

  // Rate Limiting
  rateLimit: z.object({
    windowMs: z.coerce.number().default(15 * 60 * 1000), // 15 minutes
    maxRequests: z.coerce.number().default(100),
  }),

  // Email
  email: z.object({
    adapter: z.enum(['console', 'smtp', 'resend']).default('console'),
    from: z.string().default('noreply@persona-pos.local'),
    smtp: z.object({
      host: z.string().optional(),
      port: z.coerce.number().optional(),
      secure: z.coerce.boolean().optional(),
      user: z.string().optional(),
      password: z.string().optional(),
    }).optional(),
    resendApiKey: z.string().optional(),
  }),

  // SMS
  sms: z.object({
    adapter: z.enum(['console', 'twilio']).default('console'),
    from: z.string().optional(),
    twilio: z.object({
      accountSid: z.string().optional(),
      authToken: z.string().optional(),
    }).optional(),
  }),

  // Storage
  storage: z.object({
    adapter: z.enum(['localstorage', 's3', 'azure']).default('localstorage'),
    s3: z.object({
      endpoint: z.string().optional(),
      region: z.string().optional(),
      bucket: z.string().optional(),
      accessKeyId: z.string().optional(),
      secretAccessKey: z.string().optional(),
    }).optional(),
    azure: z.object({
      accountName: z.string().optional(),
      accountKey: z.string().optional(),
      container: z.string().optional(),
    }).optional(),
  }),

  // Logging
  logging: z.object({
    level: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    file: z.string().optional(),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;

// Build configuration from environment variables
function buildConfig(): AppConfig {
  return {
    nodeEnv: (process.env.NODE_ENV as any) || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',

    database: {
      adapter: (process.env.DB_ADAPTER as any) || 'postgres',
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
      name: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      filename: process.env.DB_FILENAME,
    },

    jwt: {
      secret: process.env.JWT_SECRET || '',
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    },

    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:8080',
    },

    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    },

    email: {
      adapter: (process.env.EMAIL_ADAPTER as any) || 'console',
      from: process.env.EMAIL_FROM || 'noreply@persona-pos.local',
      smtp: {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined,
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER,
        password: process.env.SMTP_PASSWORD,
      },
      resendApiKey: process.env.EMAIL_RESEND_API_KEY,
    },

    sms: {
      adapter: (process.env.SMS_ADAPTER as any) || 'console',
      from: process.env.SMS_FROM,
      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
      },
    },

    storage: {
      adapter: (process.env.STORAGE_ADAPTER as any) || 'localstorage',
      s3: {
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION,
        bucket: process.env.S3_BUCKET,
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
      azure: {
        accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME,
        accountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY,
        container: process.env.AZURE_STORAGE_CONTAINER,
      },
    },

    logging: {
      level: (process.env.LOG_LEVEL as any) || 'info',
      file: process.env.LOG_FILE,
    },
  };
}

// Validate and export configuration
let config: AppConfig;

try {
  const rawConfig = buildConfig();
  config = configSchema.parse(rawConfig);
} catch (error) {
  console.error('❌ Configuration validation failed:');
  if (error instanceof z.ZodError) {
    error.errors.forEach((err) => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
  }
  process.exit(1);
}

export default config;
