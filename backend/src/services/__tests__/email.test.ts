import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));

vi.mock('nodemailer', () => ({ default: { createTransport }, createTransport }));

const { default: config } = await import('../../config');
const { sendEmail, resetEmailTransport } = await import('../email');

const MESSAGE = { to: 'buyer@example.com', subject: 'Receipt', text: 'Total $10.80' };

const original = { ...config.email };

beforeEach(() => {
  vi.clearAllMocks();
  resetEmailTransport();
  sendMail.mockResolvedValue({ messageId: 'm1' });
});

afterEach(() => {
  Object.assign(config.email, original);
  vi.unstubAllGlobals();
});

describe('the console adapter', () => {
  it('reports "logged", never "sent"', async () => {
    // It is the default. Calling a log entry a delivery is what made the resend
    // history untrustworthy in the first place.
    config.email.adapter = 'console';

    expect((await sendEmail(MESSAGE)).status).toBe('logged');
  });
});

describe('the SMTP adapter', () => {
  it('sends through the configured server', async () => {
    config.email.adapter = 'smtp';
    config.email.smtp = { host: 'mail.example.com', port: 587, secure: false, user: 'u', password: 'p' };

    const result = await sendEmail(MESSAGE);

    expect(result.status).toBe('sent');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'buyer@example.com' }));
  });

  it('omits auth entirely when no user is configured', async () => {
    // Anonymous relays exist. Passing an empty credential makes the server
    // reject the session rather than accept it unauthenticated.
    config.email.adapter = 'smtp';
    config.email.smtp = { host: 'mail.example.com' };

    await sendEmail(MESSAGE);

    expect(createTransport.mock.calls[0][0]).toMatchObject({ auth: undefined });
  });

  it('fails rather than pretending, when SMTP is selected but not configured', async () => {
    config.email.adapter = 'smtp';
    config.email.smtp = undefined;

    const result = await sendEmail(MESSAGE);

    expect(result.status).toBe('failed');
    expect(result.detail).toMatch(/not configured/);
  });

  it('turns a transport failure into a result rather than an exception', async () => {
    // On a resend the send *is* the request; throwing leaves the caller
    // guessing where a reportable outcome would have told them.
    config.email.adapter = 'smtp';
    config.email.smtp = { host: 'mail.example.com' };
    sendMail.mockRejectedValue(new Error('mailbox full'));

    const result = await sendEmail(MESSAGE);

    expect(result).toEqual({ status: 'failed', detail: 'mailbox full' });
  });

  it('builds the transport once across sends', async () => {
    config.email.adapter = 'smtp';
    config.email.smtp = { host: 'mail.example.com' };

    await sendEmail(MESSAGE);
    await sendEmail(MESSAGE);

    expect(createTransport).toHaveBeenCalledTimes(1);
  });
});

describe('the Resend adapter', () => {
  it('posts the message and reports success', async () => {
    config.email.adapter = 'resend';
    config.email.resendApiKey = 'key';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    expect((await sendEmail(MESSAGE)).status).toBe('sent');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.resend.com/emails');
  });

  it('keeps the reason a rejection came back with', async () => {
    // "Email failed" with no reason leaves nothing to act on; the body says
    // whether it was the key or the sending domain.
    config.email.adapter = 'resend';
    config.email.resendApiKey = 'key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'domain not verified' })
    );

    const result = await sendEmail(MESSAGE);

    expect(result.status).toBe('failed');
    expect(result.detail).toMatch(/domain not verified/);
  });

  it('fails when selected without an API key', async () => {
    config.email.adapter = 'resend';
    config.email.resendApiKey = undefined;

    expect((await sendEmail(MESSAGE)).status).toBe('failed');
  });
});
