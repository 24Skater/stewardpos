/**
 * Typed API SDK — the only sanctioned way for the app to reach the backend.
 *
 * One module per backend route file, each function mapping to an endpoint that
 * actually exists. Pages should call these (or the query hooks wrapping them)
 * rather than hand-rolling fetch paths.
 */

export { qs } from './qs';
export * from './types';

export { adminApi } from './admin';
export { apiKeysApi } from './apiKeys';
export { authApi } from './auth';
export { componentsApi } from './components';
export { customersApi } from './customers';
export { discountsApi } from './discounts';
export { drawerApi } from './drawer';
export { ordersApi } from './orders';
export { productsApi } from './products';
export { quotesApi } from './quotes';
export { receiptsApi } from './receipts';
export { returnsApi } from './returns';
export { servicesApi } from './services';
export { storeCreditsApi } from './storeCredits';
export { setupApi } from './setup';
export { terminalApi } from './terminal';
export { uploadApi } from './upload';

export type { CreateUserRequest, UpdateUserRequest, RoleInput, AuditQuery } from './admin';
export type {
  ApiDocs,
  ApiEndpointGroup,
  ApiKey,
  ApiKeyScope,
  ApiRoute,
  CreateApiKeyRequest,
  CreatedApiKey,
  UpdateApiKeyRequest,
} from './apiKeys';
export type {
  DiscountTypeInput,
  DiscountUsageQuery,
  EmployeeDiscountInput,
  PromoCodeInput,
  ValidatePromoRequest,
  ValidatePromoResponse,
  ValidatedPromo,
} from './discounts';
export type {
  Component,
  ComponentCategory,
  ComponentSide,
  ComponentUpdate,
} from './components';
export type { DrawerSession, DrawerSessionStatus } from './drawer';
export type { ReceiptEmailLog, ReceiptSearchQuery } from './receipts';
export type {
  CreateReturnItem,
  CreateReturnRequest,
  RefundMethod,
  ReturnCondition,
  ReturnListQuery,
  ReturnReasonCode,
} from './returns';
export type { VariantInput } from './products';
export type { CreateServiceRequest, UpdateServiceRequest } from './services';
export type { StoreCredit, StoreCreditStatus } from './storeCredits';
export type { CreateQuoteRequest, QuoteItemInput, UpdateQuoteRequest } from './quotes';
export type {
  AuthMethod,
  CompleteSetupRequest,
  DatabaseAdapterName,
  DatabaseConfigInput,
  SetupStatus,
} from './setup';
export type {
  ChargeStatus,
  ConnectionTestResult,
  CreateChargeRequest,
  ReaderStatus,
  TerminalCharge,
  TerminalReader,
} from './terminal';
export type { UploadKind, UploadedFile } from './upload';
