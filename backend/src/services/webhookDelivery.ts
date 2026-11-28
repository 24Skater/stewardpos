import crypto from 'crypto';
import logger from '../utils/logger';
import { callSibling } from './siblingClient';
import { decryptSecret } from './credentialCrypto';
import { assertSafeWebhookUrl, readAllowlist } from './ssrfGuard';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

// Wait after the Nth failure; a failure beyond the list marks the delivery dead.
export const BACKOFF_MS = [MINUTE_MS, 5 * MINUTE_MS, 30 * MINUTE_MS, 2 * HOUR_MS, 12 * HOUR_MS];

export const DELIVERY_BATCH_SIZE = 20;

export function signPayload(secret: string, timestamp: number, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** `failures` includes the one that just happened. */
export function nextAttemptDelay(failures: number): number | null {
  return BACKOFF_MS[failures - 1] ?? null;
}

export interface DueDelivery {
  id: string;
  eventId: string;
  eventType: string;
  orgId: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
  url: string;
  secretEnc: string;
  /** Pre-rotation secret; still signs until `secretPrevExpiresAt`. */
  secretPrevEnc?: string | null;
  secretPrevExpiresAt?: number | null;
}

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: number;
  /** True while a rotated-out secret is still being sent alongside the new one. */
  rotating: boolean;
}

export interface WebhookDeliveryRow {
  id: string;
  eventId: string;
  eventType: string;
  subscriptionId: string;
  status: string;
  attempts: number;
  nextAttemptAt: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: number;
}

export interface DeliveryMark {
  status: 'delivered' | 'failed' | 'dead';
  attempts: number;
  nextAttemptAt: number;
  lastStatusCode: number | null;
  lastError: string | null;
}

interface DeliveryAdapter {
  claimDueDeliveries(limit: number): Promise<DueDelivery[]>;
  markDelivery(id: string, mark: DeliveryMark): Promise<void>;
  getSettings(): Promise<{ providers?: Record<string, unknown> } | null | undefined>;
}

async function deliverOne(
  adapter: DeliveryAdapter,
  d: DueDelivery,
  now: number,
  allowlist: string[]
): Promise<void> {
  const body = JSON.stringify({
    id: d.eventId,
    type: d.eventType,
    createdAt: new Date(d.createdAt).toISOString(),
    orgId: d.orgId,
    data: d.payload,
  });
  const timestamp = Math.floor(now / 1000);
  let secret: string;
  try {
    secret = decryptSecret(d.secretEnc);
  } catch (error) {
    // An unreadable secret will not fix itself: retrying only delays the report.
    await adapter.markDelivery(d.id, {
      status: 'dead',
      attempts: d.attempts + 1,
      nextAttemptAt: now,
      lastStatusCode: null,
      lastError: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const attempts = d.attempts + 1;
  // Re-checked on every send: a hostname can be re-pointed at a private address after it was saved.
  try {
    await assertSafeWebhookUrl(d.url, allowlist);
  } catch (error) {
    const delay = nextAttemptDelay(attempts);
    await adapter.markDelivery(d.id, {
      status: delay === null ? 'dead' : 'failed',
      attempts,
      nextAttemptAt: now + (delay ?? 0),
      lastStatusCode: null,
      lastError: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  let signature = `t=${timestamp},v1=${signPayload(secret, timestamp, body)}`;
  if (d.secretPrevEnc && d.secretPrevExpiresAt && d.secretPrevExpiresAt > now) {
    try {
      signature += `,v1=${signPayload(decryptSecret(d.secretPrevEnc), timestamp, body)}`;
    } catch (error) {
      logger.warn('Previous webhook secret unreadable, sending the current signature only:', error);
    }
  }

  // callSibling re-serialises its body, so hand it the parsed envelope's exact
  // bytes via a pre-signed header instead of a different string.
  const result = await callSibling({
    url: d.url,
    method: 'POST',
    body: JSON.parse(body),
    headers: { 'Steward-Signature': signature },
    noRedirect: true,
  });

  if (result.ok) {
    await adapter.markDelivery(d.id, {
      status: 'delivered',
      attempts,
      nextAttemptAt: now,
      lastStatusCode: result.status,
      lastError: null,
    });
    return;
  }
  const delay = nextAttemptDelay(attempts);
  await adapter.markDelivery(d.id, {
    status: delay === null ? 'dead' : 'failed',
    attempts,
    nextAttemptAt: now + (delay ?? 0),
    lastStatusCode: result.status ?? null,
    lastError: result.error,
  });
}

/** One pass of the delivery job. */
export async function runDeliveries(adapter: DeliveryAdapter, now: number = Date.now()): Promise<void> {
  const due = await adapter.claimDueDeliveries(DELIVERY_BATCH_SIZE);
  if (due.length === 0) return;
  const allowlist = readAllowlist(await adapter.getSettings());
  await Promise.all(
    due.map((d) =>
      deliverOne(adapter, d, now, allowlist).catch((error) => logger.error('Webhook delivery bookkeeping failed:', error))
    )
  );
}
