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
  | 'register_credential'
  | 'register_shift'
  | 'register_override';

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
  /**
   * Who to attribute this to, when the request cannot say.
   *
   * A till request is authenticated by `X-Register-Token`, not a session, so
   * it has no `req.user` — but the routes that open and close a shift know
   * exactly whose PIN just matched. Without naming them the trail would record
   * only that *somebody* signed on, which is the one question a shift log
   * exists to answer.
   *
   * Takes precedence over `req.user` deliberately: where both exist the till
   * knows better than the session. Leave it unset on ordinary back-office
   * routes.
   */
  actorUserId?: string;
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
  // A PIN is weaker than a password (six digits, typed on a shared screen) —
  // its hash is exactly as unfit for a browsable audit table as a password
  // hash is. Covers both casings so a raw adapter row (snake_case) and a
  // service-mapped one (camelCase) are redacted the same way.
  'pin',
  'pinHash',
  'pin_hash',
]);

/**
 * Principals the permission system invents, which are not rows in `users`.
 *
 * `authenticate` mints `register:<uuid>` for a no-PIN till session and
 * `api-key:<uuid>` for a key, so that `requirePermission` can treat a
 * non-human caller like a person. Neither is a row in `users`, and
 * `audit_logs.user_id` is a UUID with a foreign key to that table — so
 * writing one there does not produce a badly-attributed row, it produces no
 * row at all, silently, because `audit()` never throws. Every action ever
 * performed by an API key was lost this way.
 */
const SYNTHETIC_PRINCIPAL_PREFIXES = ['register:', 'api-key:'];

function isSyntheticPrincipal(id: string): boolean {
  return SYNTHETIC_PRINCIPAL_PREFIXES.some((prefix) => id.startsWith(prefix));
}

interface Actor {
  userId: string | null;
  /** What to show when there is no user to name; null for an ordinary person. */
  actorLabel: string | null;
}

function resolveActor(req: AuthRequest, entry: AuditInput): Actor {
  // An explicit actor is the route telling us something the request cannot —
  // whose PIN matched at a till with no session. It outranks everything.
  if (entry.actorUserId) return { userId: entry.actorUserId, actorLabel: null };

  const principal = req.user;
  if (!principal) return { userId: null, actorLabel: null };
  if (!isSyntheticPrincipal(principal.id)) return { userId: principal.id, actorLabel: null };

  // Synthetic principal: keep the row and say honestly what did it, rather
  // than forcing an id the column cannot hold.
  return { userId: null, actorLabel: principal.email ?? principal.id };
}

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
    const actor = resolveActor(req, entry);

    await db.getAdapter().createAuditLog({
      // Null is a real answer — "a device did this, no human was on the
      // request" — and `audit_logs.user_id` is nullable so it can be recorded
      // rather than silently rejected. See migration 021.
      userId: actor.userId,
      actorLabel: actor.actorLabel,
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
