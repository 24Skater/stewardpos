import { test, expect, request as playwrightRequest } from '@playwright/test';

/**
 * The register completing a sale.
 *
 * `POS.tsx` is 1,669 lines at 0% unit coverage, and unit-testing it would mean
 * mocking the whole API surface it drives — which is how the two browser-only
 * defects this project already hit got through: a CORS failure on a same-origin
 * POST, and a temporal-dead-zone crash that replaced the register with an error
 * boundary on first paint. Both passed typecheck, build, and every unit test.
 *
 * These assert on what the server recorded, not only on what the screen said.
 * A register that displays the right change and stores the wrong total is the
 * failure that matters, and only the second half of that is checked here.
 */

const ADMIN = { email: 'admin@demo.local', password: 'DemoPass!1' };

/** A token for reading back what the sale actually wrote. */
async function apiContext() {
  const context = await playwrightRequest.newContext({ baseURL: 'http://localhost:3002' });
  const response = await context.post('/api/auth/login', { data: ADMIN });
  const token = (await response.json()).data.token;
  return { context, headers: { Authorization: `Bearer ${token}` } };
}

test.describe('POS checkout', () => {
  test('completes a cash sale and records it server-side', async ({ page }) => {
    const { context, headers } = await apiContext();
    const before = await context.get('/api/orders', { headers });
    const countBefore = (await before.json()).data.length;

    await page.goto('/pos');
    // The catalog has to arrive before anything is clickable; a fixed wait here
    // is what makes this kind of spec flaky.
    await page.waitForSelector('.grid > *', { timeout: 15_000 });

    await page.locator('.grid').first().locator('> *').first().click();
    await page.getByRole('button', { name: /^Checkout|^Complete Sale/i }).first().click();

    const tendered = page.locator('#cashTendered');
    await expect(tendered).toBeVisible({ timeout: 10_000 });
    await tendered.fill('50');

    await page.getByRole('button', { name: /Complete Sale/i }).first().click();

    // Poll the API rather than asserting on a toast: the toast is transient and
    // the record is the thing that matters.
    await expect
      .poll(
        async () => {
          const list = await context.get('/api/orders', { headers });
          return (await list.json()).data.length;
        },
        { timeout: 15_000 }
      )
      .toBe(countBefore + 1);

    const list = await context.get('/api/orders', { headers });
    const order = (await list.json()).data[0];

    expect(order.total).toBeGreaterThan(0);
    expect(order.amountTendered).toBe(50);
    // The register must not invent change: it is what was handed over less the
    // total the *server* priced, not the one the client claimed.
    expect(order.changeGiven).toBeCloseTo(50 - order.total, 2);

    await context.dispose();
  });

  test('refuses a tender that does not cover the sale', async ({ page }) => {
    const { context, headers } = await apiContext();
    const before = await context.get('/api/orders', { headers });
    const countBefore = (await before.json()).data.length;

    await page.goto('/pos');
    await page.waitForSelector('.grid > *', { timeout: 15_000 });
    await page.locator('.grid').first().locator('> *').first().click();
    await page.getByRole('button', { name: /^Checkout|^Complete Sale/i }).first().click();

    const tendered = page.locator('#cashTendered');
    await expect(tendered).toBeVisible({ timeout: 10_000 });
    await tendered.fill('0.01');

    await page.getByRole('button', { name: /Complete Sale/i }).first().click();
    await page.waitForTimeout(2000);

    const after = await context.get('/api/orders', { headers });
    expect((await after.json()).data.length).toBe(countBefore);

    await context.dispose();
  });

  test('loads the register without a console error', async ({ page }) => {
    // The TDZ crash that replaced the register with an error boundary showed up
    // exactly here and nowhere else in the suite.
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });

    await page.goto('/pos');
    await page.waitForSelector('.grid > *', { timeout: 15_000 });

    expect(problems).toEqual([]);
  });
});
