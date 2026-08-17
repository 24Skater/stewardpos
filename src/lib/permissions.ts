/**
 * Role and permission shapes.
 *
 * These describe the authorization model, not any particular store. They live
 * apart from the DTOs in `api/types.ts` because the same shapes are consumed by
 * the route guards and the role editor, not just by API calls.
 *
 * Keep in step with `PermissionResource` in
 * `backend/src/api/middleware/authorize.ts` — the two are the same set, and a
 * resource present in only one produces a control that always 403s, or an
 * endpoint nothing can be granted access to.
 */

export type AppRole = 'admin' | 'supervisor' | 'reporter' | 'standard';

export interface Permission {
  read: boolean;
  write: boolean;
  delete: boolean;
}

export interface RolePermissions {
  inventory: Permission;
  reports: Permission;
  exports: Permission;
  settings: Permission;
  users: Permission;
  services: Permission;
  customers: Permission;
  /** Ringing sales: orders, receipts, and the card terminal. */
  orders: Permission;
  /** Refunds and restocking. Separate from `orders` so a cashier can sell without being able to refund. */
  returns: Permission;
  /** Discount types, promo codes, and employee entitlements. */
  discounts: Permission;
  /**
   * Locations and the register estate: naming a till, enrolling it, revoking it.
   * Separate from `settings` so a store manager can manage registers without
   * also holding the payment credentials and tax rates that `settings` carries.
   */
  registers: Permission;
}

/** Every resource a role can be granted rights over, in display order. */
export const PERMISSION_RESOURCES = [
  'inventory',
  'orders',
  'returns',
  'discounts',
  'customers',
  'services',
  'reports',
  'exports',
  'registers',
  'users',
  'settings',
] as const satisfies readonly (keyof RolePermissions)[];

/** A role as returned by the API. */
export interface ApiRole {
  id: string;
  name: string;
  systemRole?: string;
  permissions: RolePermissions;
}
