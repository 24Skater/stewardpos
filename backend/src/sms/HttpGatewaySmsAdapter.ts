import type { SmsPort } from './SmsPort';

export interface HttpGatewayConfig {
  url: string;
  token: string;
}

/** Any gateway that accepts `{to, body}` as JSON with a bearer token. */
export class HttpGatewaySmsAdapter implements SmsPort {
  constructor(private readonly config: HttpGatewayConfig) {}

  async send(to: string, body: string): Promise<{ messageId?: string }> {
    const response = await fetch(this.config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`The SMS gateway refused it (${response.status}): ${text.slice(0, 200)}`);
    }
    return {};
  }
}
