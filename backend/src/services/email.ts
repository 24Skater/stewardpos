import nodemailer, { type Transporter } from 'nodemailer';
import config from '../config';
import logger from '../utils/logger';

/**
 * Outbound email.
 *
 * The receipt resend endpoint used to record `status: 'sent'` and reply
 * "Receipt sent to …" without anything being sent. A shop reading its own
 * resend history would see a customer had been emailed when they had not — the
 * worst kind of wrong, because it looks like evidence.
 *
 * `config.email.adapter` already described three of these; none was implemented.
 */
export type EmailStatus = 'sent' | 'failed' | 'logged';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailResult {
  status: EmailStatus;
  /** Why it failed, or how it was handled. Recorded, and shown to the caller. */
  detail: string;
}

/** Built once — a transport per message would open a connection per message. */
let transporter: Transporter | null = null;

function smtpTransport(): Transporter | null {
  const smtp = config.email.smtp;
  if (!smtp?.host) {
    logger.warn('Email adapter is "smtp" but EMAIL_SMTP_HOST is not set; not sending');
    return null;
  }

  transporter ??= nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port ?? 587,
    secure: smtp.secure ?? false,
    // Anonymous relays exist; only pass auth when there is some, or nodemailer
    // offers an empty credential and the server rejects the session.
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  return transporter;
}

async function sendViaSmtp(message: EmailMessage): Promise<EmailResult> {
  const transport = smtpTransport();
  if (!transport) {
    return { status: 'failed', detail: 'SMTP is selected but not configured' };
  }

  await transport.sendMail({
    from: config.email.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return { status: 'sent', detail: 'Delivered to the SMTP server' };
}

async function sendViaResend(message: EmailMessage): Promise<EmailResult> {
  const apiKey = config.email.resendApiKey;
  if (!apiKey) {
    return { status: 'failed', detail: 'Resend is selected but RESEND_API_KEY is not set' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.email.from,
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
  return { status: 'sent', detail: 'Accepted by Resend' };
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
  try {
    switch (config.email.adapter) {
      case 'smtp':
        return await sendViaSmtp(message);
      case 'resend':
        return await sendViaResend(message);
      default:
        logger.info(`[email:console] To: ${message.to} | ${message.subject}\n${message.text}`);
        return {
          status: 'logged',
          detail: 'Written to the server log; no mail adapter is configured',
        };
    }
  } catch (error) {
    logger.error('Email send failed', error);
    return {
      status: 'failed',
      detail: error instanceof Error ? error.message : 'Unknown email failure',
    };
  }
}

/** Exposed for tests; a transport built against one config must not outlive it. */
export function resetEmailTransport(): void {
  transporter = null;
}
