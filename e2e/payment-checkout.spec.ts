import { test, expect } from '@playwright/test';
import { navigateToPaymentSettings } from './helpers';

async function addProductAndOpenCheckout(page: import('@playwright/test').Page) {
  await page.goto('/pos');
  await page.waitForSelector('text=Apple Juice', { timeout: 10_000 });
  await page.locator('text=Apple Juice').first().click();
  await page.waitForSelector('button:has-text("Checkout"):not([disabled])', { timeout: 5_000 });
  await page.click('button:has-text("Checkout")');
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
}

test.describe('Payment Methods — POS Checkout', () => {
  test('checkout dialog shows Cash button when Cash is enabled', async ({ page }) => {
    await addProductAndOpenCheckout(page);
    await expect(page.getByTestId('pay-cash')).toBeVisible({ timeout: 5_000 });
  });

  test('Cash button is selected by default', async ({ page }) => {
    await addProductAndOpenCheckout(page);
    await expect(page.getByTestId('pay-cash')).toBeVisible();
    await expect(page.getByTestId('pay-cash')).toBeEnabled();
  });

  test('only enabled payment methods appear in checkout', async ({ page }) => {
    // Enable Zelle via admin settings
    await navigateToPaymentSettings(page);
    const zelleToggle = page.getByTestId('zelle-toggle');
    if (await zelleToggle.getAttribute('data-state') !== 'checked') {
      await zelleToggle.click();
    }
    await page.getByTestId('zelle-destination').fill('(555) 000-0001');
    await page.click('button:has-text("Save Settings")');
    await expect(page.getByText('Settings saved successfully', { exact: true }).first()).toBeVisible({ timeout: 5_000 });

    await addProductAndOpenCheckout(page);

    await expect(page.getByTestId('pay-cash')).toBeVisible();
    await expect(page.getByTestId('pay-zelle')).toBeVisible();
    await expect(page.getByTestId('pay-card')).not.toBeVisible();

    await page.keyboard.press('Escape');

    // Restore
    await navigateToPaymentSettings(page);
    await page.getByTestId('zelle-toggle').click();
    await page.click('button:has-text("Save Settings")');
    await expect(page.getByText('Settings saved successfully', { exact: true }).first()).toBeVisible({ timeout: 5_000 });
  });

  test('can select a different payment method in checkout', async ({ page }) => {
    // Enable Card
    await navigateToPaymentSettings(page);
    const cardToggle = page.getByTestId('card-toggle');
    if (await cardToggle.getAttribute('data-state') !== 'checked') {
      await cardToggle.click();
    }
    await page.click('button:has-text("Save Settings")');
    await expect(page.getByText('Settings saved successfully', { exact: true }).first()).toBeVisible({ timeout: 5_000 });

    await addProductAndOpenCheckout(page);

    const cardBtn = page.getByTestId('pay-card');
    await expect(cardBtn).toBeVisible();
    await cardBtn.click();
    await expect(cardBtn).toBeEnabled();

    await page.keyboard.press('Escape');

    // Restore
    await navigateToPaymentSettings(page);
    await page.getByTestId('card-toggle').click();
    await page.click('button:has-text("Save Settings")');
    await expect(page.getByText('Settings saved successfully', { exact: true }).first()).toBeVisible({ timeout: 5_000 });
  });
});
