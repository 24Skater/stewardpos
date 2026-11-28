import crypto from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import db from '../services/database';
import { providerFor, type FeatureSettings } from '../services/features';
import { decryptCredentials } from '../services/credentialCrypto';
import { normalizePhone } from '../utils/phone';
import type { InboundEvent, InboundHandler, InboundSettings } from './registry';

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_WORDS = new Set(['START', 'YES', 'UNSTOP']);

function authToken(settings: InboundSettings): string | null {
  if (providerFor(settings as FeatureSettings | null, 'sms') !== 'twilio') return null;
  const entry = (settings as FeatureSettings | null)?.providers?.sms as { credentials?: Record<string, unknown> };
  const token = decryptCredentials(entry?.credentials ?? {}).authToken;
  return typeof token === 'string' && token ? token : null;
}

/** Twilio signs URL + each POST param (sorted by name) as name+value, HMAC-SHA1, base64. */
export function twilioSignature(token: string, url: string, params: URLSearchParams): string {
  const data = [...new Set(params.keys())]
    .sort()
    .reduce((acc, key) => acc + key + (params.get(key) ?? ''), url);
  return crypto.createHmac('sha1', token).update(data).digest('base64');
}

export const twilioHandler: InboundHandler = {
  provider: 'twilio',

  isConfigured: (settings) => authToken(settings) !== null,

  verify(rawBody: Buffer, headers: IncomingHttpHeaders, settings: InboundSettings): boolean {
    const token = authToken(settings);
    const given = headers['x-twilio-signature'];
    if (!token || typeof given !== 'string') return false;
    // shortcut: URL rebuilt from the Host header, so a proxy that rewrites it breaks
    // verification; upgrade to a configured public URL if that happens.
    const proto = headers['x-forwarded-proto'] ?? 'https';
    const url = `${String(proto)}://${headers.host}/api/webhooks/twilio`;
    const expected = Buffer.from(twilioSignature(token, url, new URLSearchParams(rawBody.toString('utf8'))));
    const actual = Buffer.from(given);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  },

  parse(rawBody: Buffer): InboundEvent {
    const params = new URLSearchParams(rawBody.toString('utf8'));
    const id = params.get('MessageSid') ?? params.get('SmsSid');
    if (!id) throw new Error('Missing MessageSid');
    return { id, type: 'sms.inbound', payload: { from: params.get('From') ?? '', body: params.get('Body') ?? '' } };
  },

  async handle(event: InboundEvent): Promise<void> {
    const { from, body } = event.payload as { from: string; body: string };
    const phone = String(normalizePhone(from));
    const word = body.trim().toUpperCase();
    if (!/^\d{10}$/.test(phone)) return;
    if (STOP_WORDS.has(word)) await db.getAdapter().setSmsConsent(phone, 'opted_out', 'twilio_stop');
    else if (START_WORDS.has(word)) await db.getAdapter().setSmsConsent(phone, 'opted_in', 'twilio_start');
  },
};
