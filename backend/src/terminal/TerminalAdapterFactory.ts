import type { TerminalPort } from './TerminalPort';
import { ManualTerminalAdapter } from './ManualTerminalAdapter';
import { StripeTerminalAdapter } from './StripeTerminalAdapter';
import { SquareTerminalAdapter } from './SquareTerminalAdapter';
import { CloverTerminalAdapter } from './CloverTerminalAdapter';
import { VerifoneTerminalAdapter } from './VerifoneTerminalAdapter';
import { DejavooTerminalAdapter } from './DejavooTerminalAdapter';

export interface TerminalConfig {
  provider: string;
  // Stripe
  stripeSecretKey?: string;
  stripeTerminalLocationId?: string;
  stripeReaderId?: string;
  // Square
  squareAccessToken?: string;
  squareLocationId?: string;
  squareDeviceId?: string;
  // Clover
  cloverApiToken?: string;
  cloverMerchantId?: string;
  cloverDeviceId?: string;
  // Verifone
  verifoneApiKey?: string;
  verifoneTerminalId?: string;
  verifoneMerchantId?: string;
  // Dejavoo
  dejavooApiKey?: string;
  dejavooTerminalId?: string;
  dejavooMerchantId?: string;
}

/**
 * Raised when a provider is selected but its credentials are missing.
 *
 * Distinct from a generic failure so the route can answer "card payments are
 * not configured" instead of "internal server error". A shop that picks Stripe
 * in settings and has not yet saved a key used to get a 500 on every card
 * charge — the Stripe SDK throws from its own constructor — which reads as the
 * server being broken rather than as something the shop can fix itself.
 */
export class TerminalNotConfiguredError extends Error {
  constructor(provider: string, missing: string) {
    super(
      `Card payments are set to ${provider}, but ${missing} has not been configured. ` +
        'Add it in Settings → Payments, or switch the card provider to manual.'
    );
    this.name = 'TerminalNotConfiguredError';
  }
}

/** Fail with an explanation rather than letting a vendor SDK throw its own. */
function required(value: string | undefined, provider: string, missing: string): string {
  if (!value) throw new TerminalNotConfiguredError(provider, missing);
  return value;
}

export function createTerminalAdapter(config: TerminalConfig): TerminalPort {
  switch (config.provider) {
    case 'stripe': {
      return new StripeTerminalAdapter({
        secretKey: required(process.env.STRIPE_SECRET_KEY || config.stripeSecretKey, 'stripe', 'a Stripe secret key'),
        locationId: config.stripeTerminalLocationId || '',
        readerId: config.stripeReaderId || '',
      });
    }
    case 'square': {
      return new SquareTerminalAdapter({
        accessToken: required(process.env.SQUARE_ACCESS_TOKEN || config.squareAccessToken, 'square', 'a Square access token'),
        locationId: config.squareLocationId || '',
        deviceId: config.squareDeviceId || '',
      });
    }
    case 'clover': {
      return new CloverTerminalAdapter({
        apiToken: required(process.env.CLOVER_API_TOKEN || config.cloverApiToken, 'clover', 'a Clover API token'),
        merchantId: config.cloverMerchantId || '',
        deviceId: config.cloverDeviceId || '',
      });
    }
    case 'verifone': {
      return new VerifoneTerminalAdapter({
        apiKey: required(process.env.VERIFONE_API_KEY || config.verifoneApiKey, 'verifone', 'a Verifone API key'),
        merchantId: config.verifoneMerchantId || '',
        terminalId: config.verifoneTerminalId || '',
      });
    }
    case 'dejavoo': {
      return new DejavooTerminalAdapter({
        apiKey: required(process.env.DEJAVOO_API_KEY || config.dejavooApiKey, 'dejavoo', 'a Dejavoo API key'),
        merchantId: config.dejavooMerchantId || '',
        terminalId: config.dejavooTerminalId || '',
      });
    }
    default:
      return new ManualTerminalAdapter();
  }
}
