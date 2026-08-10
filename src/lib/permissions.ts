/**
 * Role and permission shapes.
 *
 * These live here rather than in `db.ts` because they describe the authorization
 * model, not the local database. `db.ts` and the legacy adapter layer are removed in
 * Phase 1; the API contract in `api-types.ts` needs these to outlive that.
 * `db.ts` re-exports them so existing imports keep working.
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
}

/** A role as returned by the API. */
export interface ApiRole {
  id: string;
  name: string;
  systemRole?: string;
  permissions: RolePermissions;
}
