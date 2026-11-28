import nodemailer, { type Transporter } from 'nodemailer';
import config from '../config';
import logger from '../utils/logger';
import db from './database';
import { providerFor, type FeatureSettings } from './features';
import { decryptCredentials } from './credentialCrypto';

/**
 * Outbound email.
 *
 * The receipt resend endpoint used to record `status: 'sent'` and reply
 * "Receipt sent to …" without anything being sent. A shop reading its own
 * resend history would see a customer had been emailed when they had not — the
 * worst kind of wrong, because it looks like evidence.
 */
export type EmailStatus = 'sent' | 'failed' | 'logged';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Recorded in the delivery log, e.g. 'receipt'. */
  template?: string;
}

export interface EmailResult {
  status: EmailStatus;
  /** Why it failed, or how it was handled. Recorded, and shown to the caller. */
  detail: string;
  /** The provider's id for the message, when it gave one. */
  messageId?: string;
}

interface SmtpConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
}

/** Where a message goes, decided from Settings first and the environment second. */
interface EmailTarget {
  adapter: 'smtp' | 'resend' | 'console' | 'off';
  from: string;
  smtp?: SmtpConfig;
  resendApiKey?: string;
}

/**
 * Settings win once an admin has chosen a provider; an install that has never
 * touched the setting keeps using the environment, so upgrading changes nothing.
 * An explicit `off` is honoured: it is a choice, not an absence.
 */
function resolveTarget(settings: FeatureSettings | null): EmailTarget {
  const entry = settings?.providers?.email;
  if (entry == null) {
    return {
      adapter: config.email.adapter,
      from: config.email.from,
      smtp: config.email.smtp,
      resendApiKey: config.email.resendApiKey,
    };
  }

  const provider = providerFor(settings, 'email');
  const stored = (entry as { credentials?: Record<string, unknown> }).credentials ?? {};
  const c = decryptCredentials(stored);
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const from = str(c.from) ?? config.email.from;

  if (provider === 'smtp') {
    return {
      adapter: 'smtp',
      from,
      smtp: {
        host: str(c.host),
        port: c.port ? Number(c.port) : undefined,
        secure: c.secure === true || c.secure === 'true',
        user: str(c.user),
        password: str(c.password),
      },
    };
  }
  if (provider === 'resend') {
    return { adapter: 'resend', from, resendApiKey: str(c.apiKey) };
  }
  return { adapter: 'off', from };
}

/** Built once per distinct config; a transport per message would open a connection per message. */
let transporter: Transporter | null = null;
let transporterKey = '';

function smtpTransport(smtp: SmtpConfig | undefined): Transporter | null {
  if (!smtp?.host) {
    logger.warn('Email adapter is "smtp" but no SMTP host is set; not sending');
    return null;
  }

  const key = JSON.stringify(smtp);
  if (!transporter || key !== transporterKey) {
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port ?? 587,
      secure: smtp.secure ?? false,
      // Anonymous relays exist; only pass auth when there is some, or nodemailer
      // offers an empty credential and the server rejects the session.
      auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    });
    transporterKey = key;
  }
  return transporter;
}

async function sendViaSmtp(target: EmailTarget, message: EmailMessage): Promise<EmailResult> {
  const transport = smtpTransport(target.smtp);
  if (!transport) {
    return { status: 'failed', detail: 'SMTP is selected but not configured' };
  }

  const info = await transport.sendMail({
    from: target.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return {
    status: 'sent',
    detail: 'Delivered to the SMTP server',
    ...(info?.messageId ? { messageId: String(info.messageId) } : {}),
  };
}

async function sendViaResend(target: EmailTarget, message: EmailMessage): Promise<EmailResult> {
  if (!target.resendApiKey) {
    return { status: 'failed', detail: 'Resend is selected but no API key is set' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${target.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: target.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    }),
  });

  if (!response.ok) {
    // The body carries the reason — a rejected domain, a bad key — and losing it
    // leaves "email failed" with nothing to act on.
    const body = await response.text().catch(() => '');
    return { status: 'failed', detail: `Resend refused it (${response.status}): ${body.slice(0, 200)}` };
  }
  const body = (await Promise.resolve(response.json?.()).catch(() => null)) as { id?: string } | null;
  return { status: 'sent', detail: 'Accepted by Resend', ...(body?.id ? { messageId: body.id } : {}) };
}

async function deliver(target: EmailTarget, message: EmailMessage): Promise<EmailResult> {
  switch (target.adapter) {
    case 'smtp':
      return sendViaSmtp(target, message);
    case 'resend':
      return sendViaResend(target, message);
    case 'off':
      return { status: 'failed', detail: 'Email is off' };
    default:
      logger.info(`[email:console] To: ${message.to} | ${message.subject}\n${message.text}`);
      return {
        status: 'logged',
        detail: 'Written to the server log; no mail adapter is configured',
      };
  }
}

/** One row per attempt. A log failure must not turn a delivered email into an error. */
async function recordAttempt(message: EmailMessage, result: EmailResult): Promise<void> {
  try {
    await db.getAdapter().createMessageLog({
      channel: 'email',
      template: message.template ?? 'custom',
      recipient: message.to,
      status: result.status,
      providerMessageId: result.messageId,
      error: result.status === 'failed' ? result.detail : undefined,
    });
  } catch (error) {
    logger.error('Could not record the email in the message log', error);
  }
}

/**
 * Send a message, reporting honestly what happened.
 *
 * Never throws: a receipt that could not be emailed must not fail the request
 * that triggered it, and on a resend the send *is* the request — so the caller
 * gets a result to report rather than an exception to guess at.
 *
 * The `console` adapter returns `logged`, deliberately not `sent`. It is the
 * default, and calling a log entry a delivery is the bug this replaces.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  let result: EmailResult;
  try {
    const settings = (await db.getAdapter().getSettings()) as FeatureSettings | null;
    result = await deliver(resolveTarget(settings), message);
  } catch (error) {
    logger.error('Email send failed', error);
    result = {
      status: 'failed',
      detail: error instanceof Error ? error.message : 'Unknown email failure',
    };
  }
  await recordAttempt(message, result);
  return result;
}

/** Exposed for tests; a transport built against one config must not outlive it. */
export function resetEmailTransport(): void {
  transporter = null;
  transporterKey = '';
}
