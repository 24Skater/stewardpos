import logger from '../utils/logger';
import db from './database';
import { providerFor, type FeatureSettings } from './features';
import { decryptCredentials } from './credentialCrypto';
import { createSmsAdapter } from '../sms/SmsAdapterFactory';
import { normalizePhone } from '../utils/phone';

export type SmsStatus = 'sent' | 'failed' | 'suppressed';

export interface SmsResult {
  status: SmsStatus;
  detail: string;
  messageId?: string;
}

interface QuietHours {
  start: string;
  end: string;
}

const HHMM = /^(\d{2}):(\d{2})$/;

function minutesOf(value: string): number | null {
  const m = HHMM.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** True when `now`, read in the store's time zone, falls in [start, end); a window may span midnight. */
export function inQuietHours(quiet: QuietHours | undefined, timeZone: string, now: Date = new Date()): boolean {
  const start = quiet ? minutesOf(quiet.start) : null;
  const end = quiet ? minutesOf(quiet.end) : null;
  if (start === null || end === null || start === end) return false;

  let zone = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const at =
    Number(parts.find((p) => p.type === 'hour')?.value) * 60 + Number(parts.find((p) => p.type === 'minute')?.value);
  return start < end ? at >= start && at < end : at >= start || at < end;
}

async function recordAttempt(to: string, template: string, result: SmsResult): Promise<void> {
  try {
    await db.getAdapter().createMessageLog({
      channel: 'sms',
      template,
      recipient: to,
      status: result.status,
      providerMessageId: result.messageId,
      error: result.status === 'sent' ? undefined : result.detail,
    });
  } catch (error) {
    logger.error('Could not record the SMS in the message log', error);
  }
}

async function attempt(to: string, body: string): Promise<SmsResult> {
  const adapter = db.getAdapter();
  const settings = (await adapter.getSettings()) as (FeatureSettings & { timezone?: string }) | null;
  const entry = settings?.providers?.sms as { credentials?: Record<string, unknown> } | undefined;
  const port = createSmsAdapter({
    provider: providerFor(settings, 'sms'),
    credentials: decryptCredentials(entry?.credentials ?? {}),
  });

  if ((await adapter.getSmsConsent(to)) !== 'opted_in') {
    return { status: 'suppressed', detail: 'No SMS consent for this number' };
  }
  const quiet = settings?.providers?.smsQuietHours as QuietHours | undefined;
  if (inQuietHours(quiet, settings?.timezone || 'UTC')) {
    return { status: 'suppressed', detail: 'Inside quiet hours' };
  }

  const { messageId } = await port.send(to, body);
  return { status: 'sent', detail: 'Accepted by the SMS provider', ...(messageId ? { messageId } : {}) };
}

/**
 * Send a text, reporting honestly what happened. Never throws; every attempt is logged.
 * No opted-in consent row means nothing is sent: consent is checked here, not by callers.
 */
export async function sendSms(to: string, body: string, template: string): Promise<SmsResult> {
  const phone = String(normalizePhone(to));
  let result: SmsResult;
  if (!/^\d{10}$/.test(phone)) {
    result = { status: 'failed', detail: 'Phone must be a 10-digit number' };
  } else {
    try {
      result = await attempt(phone, body);
    } catch (error) {
      logger.error('SMS send failed', error);
      result = { status: 'failed', detail: error instanceof Error ? error.message : 'Unknown SMS failure' };
    }
  }
  await recordAttempt(phone, template, result);
  return result;
}
