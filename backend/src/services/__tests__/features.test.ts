import { describe, expect, it } from 'vitest';
import { isFeatureOn, providerFor } from '../features';

describe('features', () => {
  it('treats unknown or missing features as off', () => {
    expect(isFeatureOn({ features: { tips: true } }, 'tips')).toBe(true);
    expect(isFeatureOn({ features: { tips: true } }, 'loyalty')).toBe(false);
    expect(isFeatureOn(null, 'tips')).toBe(false);
  });

  it('defaults providers to off and reads string or object entries', () => {
    expect(providerFor({}, 'email')).toBe('off');
    expect(providerFor({ providers: { email: 'smtp' } }, 'email')).toBe('smtp');
    expect(providerFor({ providers: { sms: { provider: 'twilio' } } }, 'sms')).toBe('twilio');
  });
});
