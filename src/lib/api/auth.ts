import { apiClient } from '../api-client';
import type { LoginRequest, LoginResponse, SessionResponse } from './types';

/** Auth endpoints (`backend/src/api/routes/auth.ts`). */
export const authApi = {
  login: (body: LoginRequest) => apiClient.post<LoginResponse>('/api/auth/login', body),
  logout: () => apiClient.post<void>('/api/auth/logout'),
  session: () => apiClient.get<SessionResponse>('/api/auth/session'),
  refresh: () => apiClient.post<{ token: string }>('/api/auth/refresh'),
};
