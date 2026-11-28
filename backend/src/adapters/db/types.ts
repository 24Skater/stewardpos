/**
 * Shared types for the database adapters.
 */

import { toCents, toDollars } from '../../services/pricing';

/**
 * A raw row as returned by a database driver.
 *
 * Columns are indexed rather than declared per entity because these adapters run
 * hand-written SQL whose result shape varies per query — `SELECT *` alongside joins
 * and aliased aggregates such as `GROUP_CONCAT(r.id) as role_ids` or
 * `json_agg(...) as roles`. A row is only meaningful once the mapper directly below
 * its query has interpreted it.
 *
 * This is deliberately permissive and is **not** a substitute for typing the data
 * layer properly. It exists so the project has a compiling floor; real per-query
 * result types belong with the data-layer rework in Phase 1, where the SQL and its
 * mappers are being rewritten anyway. Prefer narrowing at the mapper over widening
 * this type further.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbRow = Record<string, any>;

/**
 * Read a collection field off an untyped payload.
 *
 * Adapter methods take `Record<string, unknown>` payloads, so nested collections
 * arrive untyped. Returns an empty array for anything that is not an array, which
 * also removes a real hazard: the previous `payload.items.length` accesses would
 * throw at runtime whenever the field was present but not an array.
 */
export function asRows(value: unknown): DbRow[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Cents column to dollars for the API. node-pg returns BIGINT (and SUM of it,
 * which is NUMERIC) as a string, so the value is always coerced with Number first.
 */
export function centsToDollars(cents: unknown): number {
  return toDollars(Number(cents));
}

/** As `centsToDollars`, but keeps null/undefined (nullable columns). */
export function centsToDollarsOrNull(cents: unknown): number | null {
  return cents == null ? null : centsToDollars(cents);
}

/** Nullable dollars from a payload to cents; null/undefined stay null. */
export function toCentsOrNull(dollars: unknown): number | null {
  return dollars == null ? null : toCents(Number(dollars));
}

export interface MessageLogEntry {
  channel: 'email' | 'sms';
  template: string;
  recipient: string;
  status: 'sent' | 'failed' | 'logged' | 'suppressed';
  providerMessageId?: string;
  error?: string;
}

export interface MessageTemplateRow {
  key: string;
  channel: 'email' | 'sms';
  subject: string;
  body: string;
  enabled: boolean;
}

export function mapMessageTemplateRow(row: DbRow): MessageTemplateRow {
  return {
    key: row.key,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    enabled: row.enabled === true || row.enabled === 1,
  };
}

/** `created_at` is a Date on Postgres and epoch ms on SQLite; the API publishes epoch ms. */
export function mapMessageLogRow(row: DbRow): DbRow {
  return {
    id: row.id,
    channel: row.channel,
    template: row.template,
    recipient: row.recipient,
    status: row.status,
    providerMessageId: row.provider_message_id ?? null,
    error: row.error ?? null,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/**
 * What the till is about to charge, recorded before the card is presented.
 *
 * Shared between the adapters rather than duplicated in each, so the two
 * implementations of the same table cannot drift apart in what they accept.
 * See migration 022 for why this exists and why it is not an order.
 */
export interface PaymentAttemptCreate {
  orgId?: string | null;
  registerId?: string | null;
  cashierUserId?: string | null;
  shiftId?: string | null;
  /** The server's own priced figure, in minor units. */
  amountCents: number;
  currency: string;
  provider: string;
  /** The priced cart, so an unreconciled charge says what it was for. */
  cartSnapshot?: unknown;
}

export type PaymentAttemptStatus =
  | 'pending'
  | 'authorized'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface PaymentAttemptUpdate {
  status?: PaymentAttemptStatus;
  chargeId?: string | null;
  orderId?: string | null;
  failureReason?: string | null;
}

export interface PaymentAttempt {
  id: string;
  orgId: string | null;
  registerId: string | null;
  cashierUserId: string | null;
  shiftId: string | null;
  amountCents: number;
  currency: string;
  provider: string;
  chargeId: string | null;
  status: PaymentAttemptStatus;
  failureReason: string | null;
  orderId: string | null;
  cartSnapshot: unknown;
  createdAt: number;
  updatedAt: number;
}
