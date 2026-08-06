// Use relative path for API calls to leverage Vite proxy
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export interface ApiError {
  message: string;
  status: number;
  errors?: Record<string, string[]>;
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public message: string,
    public errors?: Record<string, string[]>,
    /**
     * The full response envelope.
     *
     * Some endpoints attach domain fields to a failure that the caller needs in order
     * to choose what to show - `hasRelatedRecords` on a blocked customer delete, for
     * one. Those used to be read off a returned envelope; now that failures throw,
     * they travel here.
     */
    public body?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

import { authStore } from './auth-store';

async function getToken(): Promise<string | null> {
  return authStore.getToken();
}

/** The envelope every backend route responds with. */
interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  errors?: Record<string, string[]>;
  meta?: ResponseMeta;
  /** Some routes name this `pagination` instead of `meta`; both are accepted. */
  pagination?: ResponseMeta;
}

/**
 * Pagination metadata on list endpoints that provide it.
 *
 * Fields beyond `total` are optional because routes differ: /api/receipts paginates
 * by offset and states `hasMore` itself, while others are page-based. Standardising
 * the backend on one shape is a later cleanup.
 */
export interface ResponseMeta {
  total: number;
  limit?: number;
  offset?: number;
  page?: number;
  hasMore?: boolean;
}

/**
 * Unwrap the backend envelope, or throw.
 *
 * Callers receive the payload, never `{success, data}`. A transport error, an HTTP
 * error status, or `success: false` all raise ApiClientError, so a returned value
 * always means the call succeeded and no caller has to re-check `success`.
 */
async function handleResponse<T>(response: Response): Promise<T> {
  const body: ApiEnvelope<T> = await response.json().catch(() => ({ success: false }));

  if (!response.ok || body.success === false) {
    if (response.status === 401) {
      onUnauthorized();
    }
    throw new ApiClientError(
      response.status,
      body.error || body.message || 'An error occurred',
      body.errors,
      body as unknown as Record<string, unknown>
    );
  }

  return body.data as T;
}

/**
 * Read the envelope's `meta` alongside the payload, for paginated endpoints.
 * Most callers want {@link handleResponse}.
 */
async function handleResponseWithMeta<T>(
  response: Response
): Promise<{ data: T; meta?: ResponseMeta }> {
  const body: ApiEnvelope<T> = await response.json().catch(() => ({ success: false }));

  if (!response.ok || body.success === false) {
    if (response.status === 401) {
      onUnauthorized();
    }
    throw new ApiClientError(
      response.status,
      body.error || body.message || 'An error occurred',
      body.errors,
      body as unknown as Record<string, unknown>
    );
  }

  return { data: body.data as T, meta: body.meta ?? body.pagination };
}

/**
 * Drop the session and send the user to sign in again.
 *
 * Centralised here so an expired token cannot leave pages retrying with a dead
 * credential. Uses a hard location change rather than the router because this runs
 * outside React and must work from any call site.
 */
function onUnauthorized(): void {
  authStore.clearToken();

  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.assign('/login');
  }
}

export const apiClient = {
  async get<T>(path: string): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    });
    return handleResponse<T>(response);
  },

  async post<T>(path: string, data?: unknown): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(data),
    });
    return handleResponse<T>(response);
  },

  async put<T>(path: string, data?: unknown): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(data),
    });
    return handleResponse<T>(response);
  },

  async delete<T>(path: string): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    });
    return handleResponse<T>(response);
  },

  /**
   * POST multipart form data (file uploads).
   *
   * Deliberately does not set `Content-Type`: the browser must generate it so it
   * can append the multipart boundary. Setting it by hand produces a body the
   * server cannot parse.
   */
  async postForm<T>(path: string, form: FormData): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: form,
    });
    return handleResponse<T>(response);
  },

  /** GET a list endpoint, keeping the envelope's pagination `meta`. */
  async getList<T>(path: string): Promise<{ data: T; meta?: ResponseMeta }> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    });
    return handleResponseWithMeta<T>(response);
  },
};

