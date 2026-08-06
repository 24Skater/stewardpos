import { apiClient } from '../api-client';
import type { Service } from './types';

export type { ServiceUnitType } from './types';

export type CreateServiceRequest = Omit<Service, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateServiceRequest = Partial<CreateServiceRequest>;

/** Service-catalog endpoints (`backend/src/api/routes/services.ts`). */
export const servicesApi = {
  list: () => apiClient.get<Service[]>('/api/services'),
  get: (id: string) => apiClient.get<Service>(`/api/services/${id}`),
  create: (body: CreateServiceRequest) => apiClient.post<Service>('/api/services', body),
  update: (id: string, body: UpdateServiceRequest) =>
    apiClient.put<Service>(`/api/services/${id}`, body),
  remove: (id: string) => apiClient.delete<void>(`/api/services/${id}`),
};
