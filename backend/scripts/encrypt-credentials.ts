/**
 * Encrypt payment credentials that were saved before encryption existed.
 *
 * The upgrade path. Setting `CREDENTIALS_KEY` protects everything saved from
 * that moment on, but a shop that configured Stripe last year still has its key
 * sitting in the clear — and the thing that leaks is a backup taken today, of
 * rows written any time.
 *
 * Safe to run repeatedly: a value already encrypted is left alone, so this can
 * be part of a deploy rather than a thing somebody has to remember exactly once.
 *
 *   npm run encrypt-credentials
 */

import db from '../src/services/database';
import logger from '../src/utils/logger';
import { encryptSecret, isEncrypted, encryptionAvailable } from '../src/services/credentialCrypto';

async function main(): Promise<void> {
  if (!encryptionAvailable()) {
    logger.error(
      'CREDENTIALS_KEY is not set, so there is nothing to encrypt these with. ' +
        'Generate one with: openssl rand -base64 32'
    );
    process.exitCode = 1;
    return;
  }

  const connected = await db.testConnection();
  if (!connected) {
    logger.error('Could not connect to the database.');
    process.exitCode = 1;
    return;
  }

  const adapter = db.getAdapter();
  const settings = (await adapter.getSettings()) as Record<string, unknown> | null;
  const config = (settings?.config as Record<string, unknown>) ?? {};
  const credentials = config.terminalCredentials as Record<string, unknown> | null | undefined;

  if (!credentials || Object.keys(credentials).length === 0) {
    logger.info('No payment credentials are stored; nothing to do.');
    await db.close();
    return;
  }

  const updated: Record<string, unknown> = {};
  let changed = 0;

  for (const [name, value] of Object.entries(credentials)) {
    if (typeof value === 'string' && value && !isEncrypted(value)) {
      updated[name] = encryptSecret(value);
      changed += 1;
      // The name only. Logging the value here would defeat the whole exercise
      // by writing the plaintext key into a log file instead of a database.
      logger.info(`Encrypted ${name}`);
    } else {
      updated[name] = value;
    }
  }

  if (changed === 0) {
    logger.info('Every stored credential is already encrypted.');
    await db.close();
    return;
  }

  await adapter.updateSettings({
    ...(settings ?? {}),
    config: { ...config, terminalCredentials: updated },
  });

  logger.info(`Encrypted ${changed} credential(s). Keep CREDENTIALS_KEY safe — without it these cannot be read back.`);
  await db.close();
}

main().catch(async (error) => {
  logger.error('Failed to encrypt credentials:', error);
  await db.close().catch(() => undefined);
  process.exitCode = 1;
});
