import { describe, it, expect, afterEach, vi } from 'vitest';
import { createTerminalAdapter, TerminalNotConfiguredError } from '../TerminalAdapterFactory';
import { ManualTerminalAdapter } from '../ManualTerminalAdapter';
import { StripeTerminalAdapter } from '../StripeTerminalAdapter';
import { SquareTerminalAdapter } from '../SquareTerminalAdapter';
import { CloverTerminalAdapter } from '../CloverTerminalAdapter';
import { VerifoneTerminalAdapter } from '../VerifoneTerminalAdapter';
import { DejavooTerminalAdapter } from '../DejavooTerminalAdapter';

/**
 * Which payment provider a store actually gets.
 *
 * `TerminalAdapterFactory.test.ts` covers the manual fallback and Stripe. This
 * covers the rest, and the part that is easiest to get wrong without noticing:
 * **an environment variable overrides the stored setting**. A stale
 * `STRIPE_SECRET_KEY` left on a host silently wins over the key the shop typed
 * into settings, so rotating the key in the UI appears to do nothing and
 * charges keep going to the old account.
 *
 * That is deliberate — env is how a deployment injects secrets — but it is
 * precedence nobody would infer from the settings screen, so it belongs in a
 * test rather than only in someone's memory.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('choosing a provider', () => {
  it('selects Square', () => {
    const adapter = createTerminalAdapter({ provider: 'square', squareAccessToken: 'sq' });

    expect(adapter).toBeInstanceOf(SquareTerminalAdapter);
  });

  it('selects Clover', () => {
    const adapter = createTerminalAdapter({ provider: 'clover', cloverApiToken: 'cl' });

    expect(adapter).toBeInstanceOf(CloverTerminalAdapter);
  });

  it('selects Verifone', () => {
    const adapter = createTerminalAdapter({ provider: 'verifone', verifoneApiKey: 'vf' });

    expect(adapter).toBeInstanceOf(VerifoneTerminalAdapter);
  });

  it('selects Dejavoo', () => {
    const adapter = createTerminalAdapter({ provider: 'dejavoo', dejavooApiKey: 'dj' });

    expect(adapter).toBeInstanceOf(DejavooTerminalAdapter);
  });

  it('falls back to manual on a provider name it does not know', () => {
    // Falling back rather than throwing is right — a typo in settings must not
    // take the till offline — but it means a misspelled provider silently stops
    // taking card payments through the real terminal.
    const adapter = createTerminalAdapter({ provider: 'strpe' });

    expect(adapter).toBeInstanceOf(ManualTerminalAdapter);
  });

  it('is case-sensitive, so "Stripe" is not "stripe"', () => {
    // Worth pinning as a fact rather than an intention: whatever writes the
    // setting must write it lower-cased, or the store quietly runs on manual.
    const adapter = createTerminalAdapter({ provider: 'Stripe' });

    expect(adapter).toBeInstanceOf(ManualTerminalAdapter);
  });
});

describe('where the credentials come from', () => {
  it('builds from the stored key when no environment variable is set', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');

    const adapter = createTerminalAdapter({ provider: 'stripe', stripeSecretKey: 'sk_from_settings' });

    expect(adapter).toBeInstanceOf(StripeTerminalAdapter);
  });

  it('builds from the environment when settings carry no key', () => {
    // Proven behaviourally: with nothing stored, construction only succeeds if
    // the environment was consulted. The adapters do not retain their config,
    // so there is nothing to read back.
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_from_env');

    expect(() => createTerminalAdapter({ provider: 'stripe' })).not.toThrow();
  });

  it('applies the same precedence for Square', () => {
    vi.stubEnv('SQUARE_ACCESS_TOKEN', 'sq_from_env');

    expect(() => createTerminalAdapter({ provider: 'square' })).not.toThrow();
  });
});

describe('a provider selected without credentials', () => {
  it('fails with an explanation rather than a vendor SDK error', () => {
    // This used to be a 500 on every card charge: the Stripe SDK throws
    // "Neither apiKey nor config.authenticator provided" from its own
    // constructor, which reads as the server being broken rather than as
    // something the shop can fix.
    vi.stubEnv('STRIPE_SECRET_KEY', '');

    expect(() => createTerminalAdapter({ provider: 'stripe' })).toThrow(
      TerminalNotConfiguredError
    );
  });

  it('names the provider and what is missing', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');

    expect(() => createTerminalAdapter({ provider: 'stripe' })).toThrow(
      /stripe.*Stripe secret key/i
    );
  });

  it('says where to fix it', () => {
    vi.stubEnv('SQUARE_ACCESS_TOKEN', '');

    expect(() => createTerminalAdapter({ provider: 'square' })).toThrow(/Settings/i);
  });

  it('applies to every real provider', () => {
    for (const [provider, envvar] of [
      ['stripe', 'STRIPE_SECRET_KEY'],
      ['square', 'SQUARE_ACCESS_TOKEN'],
      ['clover', 'CLOVER_API_TOKEN'],
      ['verifone', 'VERIFONE_API_KEY'],
      ['dejavoo', 'DEJAVOO_API_KEY'],
    ] as const) {
      vi.stubEnv(envvar, '');
      expect(() => createTerminalAdapter({ provider }), provider).toThrow(
        TerminalNotConfiguredError
      );
    }
  });

  it('does not apply to manual, which needs nothing', () => {
    expect(() => createTerminalAdapter({ provider: 'generic' })).not.toThrow();
  });
});
