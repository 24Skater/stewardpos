import { apiClient } from '../api-client';

export type ApiKeyScope = 'read' | 'write' | 'delete' | 'admin';

export interface ApiKey {
  id: string;
  name: string;
  description?: string;
  /** Non-secret display prefix; the full key is returned only once, at creation. */
  keyPrefix: string;
  scopes: ApiKeyScope[];
  rateLimit: number;
  isActive: boolean;
  lastUsedAt?: number;
  expiresAt?: number;
  createdBy?: string;
  createdByName?: string;
  createdByEmail?: string;
  createdAt: number;
}

export interface ApiRoute {
  method: string;
  path: string;
  scope: string;
  description?: string;
}

export interface ApiEndpointGroup {
  group: string;
  routes: ApiRoute[];
}

/**
 * How a key authenticates, as the server states it.
 *
 * Typed rather than left as a bag so the screen renders the server's answer
 * instead of restating it: the panel used to hard-code `Authorization: Bearer`,
 * which is the *session* header, and an integrator following it got a 401 with
 * nothing to suggest the header was wrong.
 */
export interface ApiAuthentication {
  type: string;
  header: string;
  format: string;
  example: string;
  note?: string;
}

export interface ApiDocs {
  version: string;
  baseUrl: string;
  authentication: ApiAuthentication;
  scopes: Record<string, string>;
  rateLimiting: Record<string, unknown>;
  endpoints: ApiEndpointGroup[];
  examples: Record<string, unknown>;
  errors: Record<string, string>;
}

export interface CreateApiKeyRequest {
  name: string;
  description?: string;
  scopes?: ApiKeyScope[];
  rateLimit?: number;
  /** Unix timestamp in ms. */
  expiresAt?: number;
}

export type UpdateApiKeyRequest = Partial<Omit<CreateApiKeyRequest, 'name'>> & {
  name?: string;
  isActive?: boolean;
};

/** The plaintext key, returned exactly once by {@link apiKeysApi.create}. */
export interface CreatedApiKey extends ApiKey {
  key: string;
}

/** API-key management (`backend/src/api/routes/apikeys.ts`). */
export const apiKeysApi = {
  list: () => apiClient.get<ApiKey[]>('/api/admin/api-keys'),
  get: (id: string) => apiClient.get<ApiKey>(`/api/admin/api-keys/${id}`),
  create: (body: CreateApiKeyRequest) =>
    apiClient.post<CreatedApiKey>('/api/admin/api-keys', body),
  update: (id: string, body: UpdateApiKeyRequest) =>
    apiClient.put<ApiKey>(`/api/admin/api-keys/${id}`, body),
  remove: (id: string) => apiClient.delete<void>(`/api/admin/api-keys/${id}`),
  reference: () => apiClient.get<ApiDocs>('/api/admin/api-keys/docs/reference'),
};
