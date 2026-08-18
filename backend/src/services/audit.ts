import db from './database';
import logger from '../utils/logger';
import { AuthRequest } from '../api/middleware/auth';

export type AuditAction = 'create' | 'update' | 'delete' | 'archive' | 'refund' | 'restock';

/**
 * The things worth attributing to a person. Matches the resources in the
 * permission model closely enough to answer "who changed what" for each.
 */
export type AuditEntity =
  | 'product'
  | 'category'
  | 'order'
  | 'return'
  | 'customer'
  | 'service'
  | 'quote'
  | 'discount'
  | 'promo_code'
  | 'user'
  | 'role'
  | 'settings'
  | 'api_key'
  | 'location'
  | 'register'
  | 'register_credential';

/**
 * Stand-in id for singleton entities.
 *
 * `audit_logs.entity_id` is a NOT NULL UUID, but store settings are one row with
 * no UUID of its own. The nil UUID keeps the column's type and constraint honest
 * while reading unambiguously as "the only one".
 */
export const SINGLETON_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

interface AuditInput {
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  /** State before the change; omit on create. */
  before?: unknown;
  /** State after the change; omit on delete. */
  after?: unknown;
}

/**
 * Fields that must never reach the audit table.
 *
 * An audit row is long-lived and widely readable — it is the one record an
 * operator is *meant* to browse — so writing a password hash or a payment key
 * into `before`/`after` would undo the care taken to keep them out of API
 * responses.
 */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'key',
  'terminalCredentials',
  'secret',
]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([field, fieldValue]) => [
      field,
      REDACTED_KEYS.has(field) ? '[redacted]' : redact(fieldValue),
    ])
  );
}

/**
 * Record who changed what.
 *
 * Deliberately never throws. An audit row is valuable, but failing to write one
 * must not roll back or 500 a change the user already made successfully — the
 * alternative is a database hiccup in the logging path taking down checkout.
 * Failures are logged at error level so they are still visible.
 *
 * Call after the mutation succeeds, so a rejected write leaves no trace claiming
 * it happened.
 */
export async function audit(req: AuthRequest, entry: AuditInput): Promise<void> {
  try {
    await db.getAdapter().createAuditLog({
      userId: req.user?.id ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: entry.before === undefined ? undefined : redact(entry.before),
      after: entry.after === undefined ? undefined : redact(entry.after),
    });
  } catch (error) {
    logger.error(
      `Failed to write audit log for ${entry.action} ${entry.entity} ${entry.entityId}:`,
      error
    );
  }
}
