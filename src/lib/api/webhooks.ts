import { apiClient } from '../api-client';

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dead';

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: number;
  /** True while a rotated-out secret still signs alongside the new one. */
  rotating: boolean;
}

/** Returned once, by create and rotate; the server keeps only the encrypted form. */
export interface WebhookSubscriptionWithSecret extends WebhookSubscription {
  secret: string;
}

export interface WebhookDelivery {
  id: string;
  eventId: string;
  eventType: string;
  subscriptionId: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: number;
}

/** Webhook subscription admin (`backend/src/api/routes/webhookSubscriptions.ts`). */
export const webhooksApi = {
  list: () => apiClient.get<WebhookSubscription[]>('/api/admin/webhooks'),
  create: (body: { url: string; events: string[] }) =>
    apiClient.post<WebhookSubscriptionWithSecret>('/api/admin/webhooks', body),
  update: (id: string, body: { url?: string; events?: string[]; active?: boolean }) =>
    apiClient.put<WebhookSubscription>(`/api/admin/webhooks/${id}`, body),
  remove: (id: string) => apiClient.delete<void>(`/api/admin/webhooks/${id}`),
  rotateSecret: (id: string) =>
    apiClient.post<WebhookSubscriptionWithSecret>(`/api/admin/webhooks/${id}/rotate-secret`),
  deliveries: (status?: WebhookDeliveryStatus) =>
    apiClient.get<WebhookDelivery[]>(`/api/admin/webhooks/deliveries${status ? `?status=${status}` : ''}`),
  redeliver: (id: string) => apiClient.post<void>(`/api/admin/webhooks/deliveries/${id}/redeliver`),
};
