// Re-export and map types from the existing db.ts
// This allows gradual migration
export type {
  Product as Item,
  ProductVariant as Variant,
  Category,
  Order,
  OrderItem,
  Customer,
  Service,
  User,
  Role,
  Settings,
  AuditLog,
  Quote,
  QuoteItem,
  AppRole,
  Permission as DomainPermission,
  RolePermissions,
} from '../../lib/db';
