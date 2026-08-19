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
export { categoriesApi } from './categories';
export { registersApi, locationsApi } from './registers';
export { quotesApi } from './quotes';
export { receiptsApi } from './receipts';
export { reportsApi } from './reports';
export { returnsApi } from './returns';
export { servicesApi } from './services';
export { storeCreditsApi } from './storeCredits';
export { setupApi } from './setup';
export { terminalApi } from './terminal';
export { uploadApi } from './upload';

export type {
  CreateUserRequest,
  UpdateUserRequest,
  RoleInput,
  AuditQuery,
  SetPinRequest,
  UserPinStatus,
} from './admin';
export type {
  ApiAuthentication,
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
  CashierSales,
  DrawerCapabilitySplit,
  DrawerVarianceByRegister,
  NoSaleCount,
  PaymentMix,
  RegisterCapabilityBucket,
  RegisterHourly,
  RegisterHourlyQuery,
  RegisterSales,
  ReportRangeQuery,
  ReturnsByReason,
  ReturnsSummary,
  SalesByDay,
  SalesByLocation,
  SalesByRegisterResult,
  SalesSummary,
  TopProduct,
  TopProductsQuery,
} from './reports';
export type {
  CreateReturnItem,
  CreateReturnRequest,
  RefundMethod,
  ReturnCondition,
  ReturnListQuery,
  ReturnReasonCode,
} from './returns';
export type { LowStockItem, ProductQuery, VariantInput } from './products';
export type { Category, CategoryInput, UnmanagedCategory } from './categories';
export type {
  CreateLocationRequest,
  CreateRegisterRequest,
  CurrentShiftResult,
  Location,
  LocationStatus,
  OverrideAction,
  PairDeviceResult,
  Register,
  RegisterListQuery,
  RegisterLiveness,
  RegisterOverride,
  RegisterOverrideQuery,
  RegisterPairingCode,
  RegisterStatus,
  RegisterType,
  RequestOverrideRequest,
  RequestOverrideResult,
  RevokeRegisterRequest,
  RevokeRegisterResult,
  Shift,
  ShiftCashier,
  ShiftEndReason,
  StartShiftResult,
  UpdateLocationRequest,
  UpdateRegisterRequest,
} from './registers';
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
