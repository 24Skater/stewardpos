import type { CallerRegister } from '../api/middleware/registerContext';
import { ServiceUnavailableError } from '../utils/errors';
import {
  createTerminalAdapter,
  TerminalNotConfiguredError,
  type TerminalConfig,
} from '../terminal/TerminalAdapterFactory';
import type { TerminalPort } from '../terminal/TerminalPort';

/**
 * Building the card-terminal adapter for whoever is asking.
 *
 * Lifted out of the terminal route unchanged, because refunds need the same
 * credentials as charges and a second copy of this resolution would drift. The
 * returns desk and the till have to agree on which account a sale belongs to,
 * or a refund goes to the wrong merchant.
 */

/**
 * Which reader field a provider actually reads its device id from.
 *
 * A register stores one `terminal_device_id` because it has one reader; each
 * vendor SDK just calls it something different.
 */
const DEVICE_FIELD_BY_PROVIDER: Record<string, keyof TerminalConfig> = {
  stripe: 'stripeReaderId',
  square: 'squareDeviceId',
  clover: 'cloverDeviceId',
  verifone: 'verifoneTerminalId',
};

interface SettingsReader {
  getSettings(): Promise<Record<string, unknown> | null | undefined>;
}

export interface ResolvedTerminal {
  terminal: TerminalPort;
  provider: string;
}

/**
 * Merchant credentials stay org-wide — a secret key or access token identifies
 * the *account*, and every register in a shop bills to the same one. What is
 * per-register is the **device**: three tills have three readers, and a single
 * global device id would mean every register tried to drive the same one.
 *
 * A register with no binding falls back to the store settings, which is exactly
 * what every existing single-register install already does.
 *
 * Refund callers pass no register: sending money back is an API call against
 * the account, with no reader involved, so a device binding would be noise.
 */
export async function resolveTerminal(
  dbAdapter: SettingsReader,
  register?: CallerRegister
): Promise<ResolvedTerminal> {
  const settings = await dbAdapter.getSettings();
  const config = (settings?.config as Record<string, unknown>) || {};
  const paymentMethods = config.paymentMethods as Record<string, unknown> | undefined;
  const card = paymentMethods?.card as Record<string, unknown> | undefined;
  const provider = register?.terminalProvider || (card?.provider as string) || 'generic';
  const creds = (config.terminalCredentials || {}) as Partial<TerminalConfig>;

  // The register's reader wins over the store-wide one when it has been bound.
  const deviceField = DEVICE_FIELD_BY_PROVIDER[provider];
  const binding: Partial<TerminalConfig> =
    register?.terminalDeviceId && deviceField
      ? { [deviceField]: register.terminalDeviceId }
      : {};

  try {
    return { terminal: createTerminalAdapter({ provider, ...creds, ...binding }), provider };
  } catch (error) {
    // A store that selected a provider and has not saved its credentials yet is
    // misconfigured, not broken. 503 with the reason, rather than the 500 the
    // vendor SDK's own constructor error produced.
    if (error instanceof TerminalNotConfiguredError) {
      throw new ServiceUnavailableError(error.message);
    }
    throw error;
  }
}
