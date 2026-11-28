import { SmsNotConfiguredError, type SmsPort } from './SmsPort';
import { TwilioSmsAdapter } from './TwilioSmsAdapter';
import { HttpGatewaySmsAdapter } from './HttpGatewaySmsAdapter';

export interface SmsConfig {
  provider: string;
  /** Already decrypted. */
  credentials: Record<string, unknown>;
}

function required(credentials: Record<string, unknown>, provider: string, key: string, label: string): string {
  const value = credentials[key];
  if (typeof value !== 'string' || !value) {
    throw new SmsNotConfiguredError(`SMS is set to ${provider}, but ${label} has not been configured`);
  }
  return value;
}

export function createSmsAdapter({ provider, credentials }: SmsConfig): SmsPort {
  switch (provider) {
    case 'twilio':
      return new TwilioSmsAdapter({
        accountSid: required(credentials, provider, 'accountSid', 'an account SID'),
        authToken: required(credentials, provider, 'authToken', 'an auth token'),
        from: required(credentials, provider, 'from', 'a from number'),
      });
    case 'http':
      return new HttpGatewaySmsAdapter({
        url: required(credentials, provider, 'url', 'a gateway URL'),
        token: required(credentials, provider, 'token', 'a bearer token'),
      });
    default:
      throw new SmsNotConfiguredError('SMS is off');
  }
}
