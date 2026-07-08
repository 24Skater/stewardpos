import { describe, it, expect } from 'vitest';
import { createTerminalAdapter } from '../TerminalAdapterFactory';
import { ManualTerminalAdapter } from '../ManualTerminalAdapter';

describe('createTerminalAdapter', () => {
  it('returns ManualTerminalAdapter for generic provider', () => {
    const adapter = createTerminalAdapter({ provider: 'generic' });
    expect(adapter).toBeInstanceOf(ManualTerminalAdapter);
  });

  it('returns ManualTerminalAdapter when provider is empty', () => {
    const adapter = createTerminalAdapter({ provider: '' });
    expect(adapter).toBeInstanceOf(ManualTerminalAdapter);
  });

  it('returns ManualTerminalAdapter for unknown provider', () => {
    const adapter = createTerminalAdapter({ provider: 'unknown_brand' });
    expect(adapter).toBeInstanceOf(ManualTerminalAdapter);
  });

  it('returns StripeTerminalAdapter for stripe provider', async () => {
    const { StripeTerminalAdapter } = await import('../StripeTerminalAdapter');
    const adapter = createTerminalAdapter({
      provider: 'stripe',
      stripeSecretKey: 'sk_test_dummy',
      stripeReaderId: 'tmr_dummy',
      stripeTerminalLocationId: 'tml_dummy',
    });
    expect(adapter).toBeInstanceOf(StripeTerminalAdapter);
  });
});
