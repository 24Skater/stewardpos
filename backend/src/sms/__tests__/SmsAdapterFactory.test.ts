import { describe, it, expect } from 'vitest';
import { createSmsAdapter } from '../SmsAdapterFactory';
import { SmsNotConfiguredError } from '../SmsPort';

describe('createSmsAdapter', () => {
  it('throws SmsNotConfiguredError when off', () => {
    expect(() => createSmsAdapter({ provider: 'off', credentials: {} })).toThrow(SmsNotConfiguredError);
  });

  it('throws when credentials are missing', () => {
    expect(() => createSmsAdapter({ provider: 'twilio', credentials: { accountSid: 'AC1' } })).toThrow(
      /auth token/
    );
  });

  it('builds a gateway adapter from url and token', () => {
    expect(createSmsAdapter({ provider: 'http', credentials: { url: 'https://x.test', token: 't' } })).toBeTruthy();
  });
});
