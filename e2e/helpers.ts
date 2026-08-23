import { Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

export async function navigateToPaymentSettings(page: Page) {
  await page.goto('/admin/settings');
  await page.waitForSelector('text=Payments', { timeout: 10_000 });
  await page.click('text=Payments');
  await page.waitForSelector('[data-testid="cash-toggle"]', { timeout: 5_000 });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The register `global-setup.ts` paired this browser to.
 *
 * Specs that ring a sale through the API have to name it. Without a register
 * header the backend falls back to the org's first active register — the
 * shop's own till — which requires a cashier to be signed on and has no shift
 * open, because the suite's shift belongs to the register it owns. Read from
 * the storage state rather than hardcoded so there is exactly one place that
 * decides which register the suite uses.
 */
export function pairedRegisterId(): string {
  const state = JSON.parse(readFileSync(path.join(__dirname, '.auth.json'), 'utf8'));
  for (const origin of state.origins ?? []) {
    for (const entry of origin.localStorage ?? []) {
      if (entry.name === 'steward-terminal-register-id') return entry.value;
    }
  }
  throw new Error('No paired register in the storage state; did global setup run?');
}
