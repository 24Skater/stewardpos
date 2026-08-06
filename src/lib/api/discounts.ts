import { apiClient } from '../api-client';
import { qs } from './qs';
import type { DiscountStats, DiscountType, EmployeeDiscount, PromoCode } from './types';

export interface DiscountTypeInput {
  name: string;
  description?: string;
  code?: string;
  discountType: 'percentage' | 'fixed' | 'buy_x_get_y';
  discountValue: number;
  minPurchase?: number;
  maxDiscount?: number | null;
  appliesTo?: 'all' | 'products' | 'services' | 'categories';
  applicableIds?: string[];
  requiresApproval?: boolean;
  approvalThreshold?: number | null;
  requiresEmployeeId?: boolean;
  displayOrder?: number;
  color?: string;
  icon?: string;
  showInPos?: boolean;
  isActive?: boolean;
}

export interface PromoCodeInput {
  code: string;
  name: string;
  description?: string;
  discountType: 'percentage' | 'fixed' | 'free_shipping' | 'buy_x_get_y' | 'free_item';
  discountValue: number;
  buyQuantity?: number;
  getQuantity?: number;
  getProductId?: string;
  minPurchase?: number;
  maxDiscount?: number | null;
  minItems?: number;
  appliesTo?: 'all' | 'products' | 'services' | 'categories' | 'specific_items';
  applicableIds?: string[];
  excludedIds?: string[];
  firstOrderOnly?: boolean;
  specificCustomers?: string[];
  customerGroups?: string[];
  maxUses?: number | null;
  maxUsesPerCustomer?: number;
  /** ISO-8601 datetime string — the backend validates it as such, not as epoch ms. */
  startsAt: string;
  expiresAt?: string | null;
  stackable?: boolean;
  priority?: number;
  isActive?: boolean;
}

export interface EmployeeDiscountInput {
  userId: string;
  discountPercentage?: number;
  maxDiscountAmount?: number | null;
  requiresManagerApprovalAbove?: number | null;
  allowedCategories?: string[];
  isActive?: boolean;
}

export interface ValidatePromoRequest {
  code: string;
  cartTotal: number;
  itemCount: number;
  customerId?: string;
  customerEmail?: string;
  isFirstOrder?: boolean;
  productIds?: string[];
  categoryIds?: string[];
}

export interface ValidatePromoResponse {
  valid: boolean;
  reason?: string;
  discountAmount?: number;
  promo?: PromoCode;
}

export interface DiscountUsageQuery {
  orderId?: string;
  customerId?: string;
  startDate?: number;
  endDate?: number;
}

/**
 * Discount endpoints (`backend/src/api/routes/discounts.ts`).
 *
 * Three distinct things live under one route module: reusable discount *types*,
 * customer-facing *promo codes*, and per-employee entitlements. They are grouped
 * here the same way to keep the SDK path-for-path with the backend.
 */
export const discountsApi = {
  types: {
    list: () => apiClient.get<DiscountType[]>('/api/discounts/types'),
    /** Only those flagged `showInPos` — what the register offers a cashier. */
    listForPos: () => apiClient.get<DiscountType[]>('/api/discounts/types/pos'),
    get: (id: string) => apiClient.get<DiscountType>(`/api/discounts/types/${id}`),
    create: (body: DiscountTypeInput) =>
      apiClient.post<DiscountType>('/api/discounts/types', body),
    update: (id: string, body: Partial<DiscountTypeInput>) =>
      apiClient.put<DiscountType>(`/api/discounts/types/${id}`, body),
    remove: (id: string) => apiClient.delete<void>(`/api/discounts/types/${id}`),
  },

  promos: {
    list: () => apiClient.get<PromoCode[]>('/api/discounts/promos'),
    get: (id: string) => apiClient.get<PromoCode>(`/api/discounts/promos/${id}`),
    create: (body: PromoCodeInput) => apiClient.post<PromoCode>('/api/discounts/promos', body),
    update: (id: string, body: Partial<PromoCodeInput>) =>
      apiClient.put<PromoCode>(`/api/discounts/promos/${id}`, body),
    remove: (id: string) => apiClient.delete<void>(`/api/discounts/promos/${id}`),
    validate: (body: ValidatePromoRequest) =>
      apiClient.post<ValidatePromoResponse>('/api/discounts/promos/validate', body),
    /** Records a redemption; call only after the order commits. */
    markUsed: (id: string, body?: { orderId?: string; customerId?: string }) =>
      apiClient.post<void>(`/api/discounts/promos/${id}/use`, body),
  },

  employee: {
    list: () => apiClient.get<EmployeeDiscount[]>('/api/discounts/employee'),
    get: (userId: string) => apiClient.get<EmployeeDiscount>(`/api/discounts/employee/${userId}`),
    upsert: (body: EmployeeDiscountInput) =>
      apiClient.post<EmployeeDiscount>('/api/discounts/employee', body),
    remove: (userId: string) => apiClient.delete<void>(`/api/discounts/employee/${userId}`),
  },

  usage: {
    list: (query?: DiscountUsageQuery) =>
      apiClient.get<unknown[]>(`/api/discounts/usage${qs(query)}`),
    record: (body: Record<string, unknown>) => apiClient.post<void>('/api/discounts/usage', body),
  },

  stats: (range?: { startDate?: number; endDate?: number }) =>
    apiClient.get<DiscountStats>(`/api/discounts/stats${qs(range)}`),
};
