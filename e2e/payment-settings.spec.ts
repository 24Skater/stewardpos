import { test, expect } from '@playwright/test';
import { navigateToPaymentSettings } from './helpers';

test.describe('Payment Methods — Admin Settings', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPaymentSettings(page);
  });

  test('shows the Payments tab with all three method toggles', async ({ page }) => {
    await expect(page.getByTestId('cash-toggle')).toBeVisible();
    await expect(page.getByTestId('zelle-toggle')).toBeVisible();
    await expect(page.getByTestId('card-toggle')).toBeVisible();
  });

  test('Cash is enabled by default', async ({ page }) => {
    const cashToggle = page.getByTestId('cash-toggle');
    await expect(cashToggle).toHaveAttribute('data-state', 'checked');
  });

  test('enabling Zelle reveals the destination field', async ({ page }) => {
    // Ensure Zelle is off first (reset state)
    const zelleToggle = page.getByTestId('zelle-toggle');
    const state = await zelleToggle.getAttribute('data-state');
    if (state === 'checked') {
      await zelleToggle.click();
    }
    await expect(page.getByTestId('zelle-destination')).not.toBeVisible();
    await zelleToggle.click();
    await expect(page.getByTestId('zelle-destination')).toBeVisible();
    // Reset
    await zelleToggle.click();
  });

  test('enabling Card reveals the provider selector', async ({ page }) => {
    const cardToggle = page.getByTestId('card-toggle');
    const state = await cardToggle.getAttribute('data-state');
    if (state === 'checked') {
      await cardToggle.click();
    }
    await expect(page.getByTestId('card-provider-select')).not.toBeVisible();
    await cardToggle.click();
    await expect(page.getByTestId('card-provider-select')).toBeVisible();
    // Reset
    await cardToggle.click();
  });

  test('saves payment method settings and persists on reload', async ({ page }) => {
    // Ensure Zelle starts disabled
    const zelleToggle = page.getByTestId('zelle-toggle');
    if (await zelleToggle.getAttribute('data-state') === 'checked') {
      await zelleToggle.click();
      await page.click('button:has-text("Save Settings")');
      await page.waitForTimeout(500);
      await navigateToPaymentSettings(page);
    }

    // Enable Zelle with a destination
    await zelleToggle.click();
    await page.getByTestId('zelle-destination').fill('payments@mystore.com');

    await page.click('button:has-text("Save Settings")');
    await expect(page.getByText('Settings saved successfully', { exact: true }).first()).toBeVisible({ timeout: 5_000 });

    // Reload and verify persistence
    await navigateToPaymentSettings(page);
    await expect(page.getByTestId('zelle-toggle')).toHaveAttribute('data-state', 'checked');
    await expect(page.getByTestId('zelle-destination')).toHaveValue('payments@mystore.com');

    // Restore: disable Zelle
    await page.getByTestId('zelle-toggle').click();
    await page.click('button:has-text("Save Settings")');
    await expect(page.getByText('Settings saved successfully', { exact: true }).first()).toBeVisible({ timeout: 5_000 });
  });
});
