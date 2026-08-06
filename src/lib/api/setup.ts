import { apiClient } from '../api-client';

export type DatabaseAdapterName = 'postgres' | 'sqlite';
export type AuthMethod = 'local' | 'google' | 'oidc';

export interface DatabaseConfigInput {
  adapter: DatabaseAdapterName;
  host?: string;
  port?: number;
  name?: string;
  user?: string;
  password?: string;
  /** SQLite only. */
  filename?: string;
}

export interface SetupStatus {
  isInitialized: boolean;
  hasAdminUser: boolean;
  needsSetup: boolean;
  databaseAdapter: DatabaseAdapterName;
}

export interface CompleteSetupRequest {
  adminUser: {
    name: string;
    email: string;
    password: string;
  };
  database: DatabaseConfigInput;
  auth: {
    methods: AuthMethod[];
    google?: { clientId?: string; clientSecret?: string };
    oidc?: { issuer?: string; clientId?: string; clientSecret?: string };
  };
  environment?: 'development' | 'staging' | 'production';
  demoMode?: boolean;
  replication?: {
    enabled?: boolean;
    source?: 'dev' | 'qa' | 'prod';
    target?: 'dev' | 'qa' | 'prod';
  };
}

/**
 * First-run setup (`backend/src/api/routes/setup.ts`).
 *
 * Unauthenticated by design, and guarded server-side: once an admin exists,
 * `testDatabase` and `complete` are rejected outright, so these cannot be
 * replayed to take over a live install.
 */
export const setupApi = {
  status: () => apiClient.get<SetupStatus>('/api/setup/status'),
  testDatabase: (body: DatabaseConfigInput) =>
    apiClient.post<{ connected: boolean; message?: string }>('/api/setup/test-database', body),
  complete: (body: CompleteSetupRequest) => apiClient.post<unknown>('/api/setup/complete', body),
};
