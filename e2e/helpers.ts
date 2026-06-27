import { Page } from '@playwright/test';

export async function navigateToPaymentSettings(page: Page) {
  await page.goto('/admin/settings');
  await page.waitForSelector('text=Payments', { timeout: 10_000 });
  await page.click('text=Payments');
  await page.waitForSelector('[data-testid="cash-toggle"]', { timeout: 5_000 });
}
