import type { SmsPort } from './SmsPort';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from: string;
}

export class TwilioSmsAdapter implements SmsPort {
  constructor(private readonly config: TwilioConfig) {}

  async send(to: string, body: string): Promise<{ messageId?: string }> {
    const { accountSid, authToken, from } = this.config;
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: `+1${to}`, From: from, Body: body }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Twilio refused it (${response.status}): ${text.slice(0, 200)}`);
    }
    const json = (await response.json().catch(() => null)) as { sid?: string } | null;
    return { messageId: json?.sid };
  }
}
