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

export function createTerminalAdapter(config: TerminalConfig): TerminalPort {
  switch (config.provider) {
    case 'stripe': {
      return new StripeTerminalAdapter({
        secretKey: process.env.STRIPE_SECRET_KEY || config.stripeSecretKey || '',
        locationId: config.stripeTerminalLocationId || '',
        readerId: config.stripeReaderId || '',
      });
    }
    case 'square': {
      return new SquareTerminalAdapter({
        accessToken: process.env.SQUARE_ACCESS_TOKEN || config.squareAccessToken || '',
        locationId: config.squareLocationId || '',
        deviceId: config.squareDeviceId || '',
      });
    }
    case 'clover': {
      return new CloverTerminalAdapter({
        apiToken: process.env.CLOVER_API_TOKEN || config.cloverApiToken || '',
        merchantId: config.cloverMerchantId || '',
        deviceId: config.cloverDeviceId || '',
      });
    }
    case 'verifone': {
      return new VerifoneTerminalAdapter({
        apiKey: process.env.VERIFONE_API_KEY || config.verifoneApiKey || '',
        merchantId: config.verifoneMerchantId || '',
        terminalId: config.verifoneTerminalId || '',
      });
    }
    case 'dejavoo': {
      return new DejavooTerminalAdapter({
        apiKey: process.env.DEJAVOO_API_KEY || config.dejavooApiKey || '',
        merchantId: config.dejavooMerchantId || '',
        terminalId: config.dejavooTerminalId || '',
      });
    }
    default:
      return new ManualTerminalAdapter();
  }
}
