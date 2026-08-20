import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';

/**
 * A return, driven through the register.
 *
 * The go-live checklist asks for "e2e sale **+ return** pass in CI", and only
 * the sale half existed. Returns are the second place this application moves
 * money, and the only one that moves it *outwards* — a return that refunds the
 * wrong amount, or restocks an item it did not take back, is a shop losing
 * goods and cash at once.
 *
 * As in `checkout.spec.ts`, the assertions are on what the **server** recorded.
 * A dialog that displays the right refund and posts a different one is exactly
 * the failure worth catching, and the screen tells you nothing about it.
 *
 * The sale being returned is placed over the API rather than through the
 * register: this spec is about the return, and re-driving checkout would make
 * it fail for the other flow's reasons.
 */

const ADMIN = { email: 'admin@demo.local', password: 'DemoPass!1' };

interface Api {
  context: APIRequestContext;
  headers: Record<string, string>;
}

async function apiContext(): Promise<Api> {
  const context = await playwrightRequest.newContext({ baseURL: 'http://localhost:3002' });
  const response = await context.post('/api/auth/login', { data: ADMIN });
  const token = (await response.json()).data.token;
  return { context, headers: { Authorization: `Bearer ${token}` } };
}

/** A sellable product with stock, and the variant to sell. */
async function sellableVariant({ context, headers }: Api) {
  const response = await context.get('/api/products?limit=50', { headers });
  const products = (await response.json()).data as Array<{
    id: string;
    name: string;
    variants?: Array<{ id: string; stock: number; enabled?: boolean }>;
  }>;

  for (const product of products) {
    const variant = (product.variants ?? []).find((v) => v.enabled !== false && v.stock > 2);
    if (variant) return { product, variant };
  }

  throw new Error('The seeded catalog has no variant with stock to sell; cannot test a return.');
}

/**
 * Ring up two units, letting the server price them.
 *
 * Quantity two so the return can take one back and leave one, which is the case
 * that distinguishes a real partial return from "refund the whole order".
 */
async function placeOrder({ context, headers }: Api, productId: string, variantId: string) {
  const items = [{ productId, variantId, quantity: 2 }];

  // Quote first, then tender the quoted figure. The server refuses a cash
  // payment that does not cover the sale, and it will not accept a total the
  // client made up — which is the whole point of the quote endpoint, and the
  // reason this cannot simply post an amount.
  const quoted = await context.post('/api/orders/quote', { headers, data: { items } });
  expect(quoted.ok(), `quote failed: ${await quoted.text()}`).toBeTruthy();
  const { total } = (await quoted.json()).data as { total: number };

  const response = await context.post('/api/orders', {
    headers,
    data: {
      items,
      paymentMethod: 'Cash',
      payments: [{ method: 'cash', amount: total }],
      amountTendered: total,
    },
  });

  expect(response.ok(), `order create failed: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data as { id: string; total: number; items: Array<{ id: string }> };
}

/**
 * The returns recorded against one sale.
 *
 * Read through `/api/receipts/:id`, which carries them, rather than
 * `/api/returns?originalOrderId=` — that filter does not exist, and the list
 * endpoint would have quietly ignored it and answered with every return in the
 * database. A test that passes because it found somebody else's row is worse
 * than no test.
 */
async function returnsForOrder({ context, headers }: Api, orderId: string) {
  const response = await context.get(`/api/receipts/${orderId}`, { headers });
  const receipt = (await response.json()).data as {
    returns: Array<{ total: number; status: string; originalOrderId?: string }>;
  };
  return receipt.returns ?? [];
}

async function variantStock({ context, headers }: Api, productId: string, variantId: string) {
  const response = await context.get(`/api/products/${productId}`, { headers });
  const product = (await response.json()).data as { variants: Array<{ id: string; stock: number }> };
  return product.variants.find((v) => v.id === variantId)!.stock;
}

test.describe('returns', () => {
  test('refunds one unit of a two-unit sale, priced by the server', async ({ page }) => {
    const api = await apiContext();
    const { product, variant } = await sellableVariant(api);

    const order = await placeOrder(api, product.id, variant.id);
    const stockAfterSale = await variantStock(api, product.id, variant.id);

    await page.goto('/pos');
    await page.waitForSelector('.grid > *', { timeout: 15_000 });

    await page.getByRole('button', { name: /Returns/i }).first().click();

    // The dialog opens on "Recent Receipts"; the lookup field lives on the other
    // tab and is not in the DOM until that tab is selected.
    await page.getByRole('tab', { name: /^Search$/i }).click();

    // It finds the order by the first eight characters of its id, which is what
    // a receipt prints.
    const search = page.getByPlaceholder(/Enter receipt # or order ID/i);
    await expect(search).toBeVisible({ timeout: 10_000 });
    await search.fill(order.id.slice(0, 8).toUpperCase());
    await page.getByRole('button', { name: /^Find$/i }).click();

    // Selecting the line enables its quantity field; the default is the whole
    // line, so one unit has to be asked for explicitly.
    const checkbox = page.getByRole('checkbox').first();
    await expect(checkbox).toBeVisible({ timeout: 10_000 });
    await checkbox.click();

    const quantity = page.locator('input[type="number"]').first();
    await quantity.fill('1');

    await page.getByRole('button', { name: /Refund \$|Submit for Approval/i }).click();

    // Poll the server rather than the screen: the toast is transient, and the
    // record is the thing a shop is answerable for.
    await expect
      .poll(async () => (await returnsForOrder(api, order.id)).length, { timeout: 20_000 })
      .toBe(1);

    const [created] = await returnsForOrder(api, order.id);

    // Half the order, because one of two units came back — and priced from the
    // order rather than from anything the dialog posted.
    expect(created.total).toBeGreaterThan(0);
    expect(created.total).toBeLessThan(order.total);
    expect(created.total).toBeCloseTo(order.total / 2, 1);

    // Restocking is gated on approval: `returns.ts` refuses it for anything not
    // `approved` or `completed`. A return still awaiting a manager that had
    // already restocked would show goods the shop does not physically have —
    // and one that reached approval without restocking loses them.
    //
    // Which state a return lands in depends on the store's approval settings,
    // so the assertion follows the rule rather than assuming an outcome.
    //
    // Polled, not read once. Creating a return, approving it, and restocking it
    // are three separate requests (`POST /api/returns`, then the approval, then
    // `POST /api/returns/:id/restock`). Reading the status and the stock as two
    // independent snapshots let the status settle to `approved` while the
    // restock it implies had not landed yet — the assertion then demanded a
    // unit back that was still in flight, and this test failed about one full
    // run in five while passing every time in isolation.
    //
    // What is actually being asserted is that the two agree, so wait for them
    // to agree rather than catching them mid-step.
    await expect
      .poll(
        async () => {
          const [current] = await returnsForOrder(api, order.id);
          const stock = await variantStock(api, product.id, variant.id);
          const restockable = current.status === 'approved' || current.status === 'completed';
          const expected = restockable ? stockAfterSale + 1 : stockAfterSale;
          return `${current.status}: stock ${stock}, expected ${expected}`;
        },
        { timeout: 20_000 }
      )
      // The backreference is the assertion: whatever the status turned out to
      // be, the stock has to match what that status implies.
      .toMatch(/stock (\d+), expected \1$/);

    await api.context.dispose();
  });

  test('will not refund more than was bought', async ({ page }) => {
    // The server reprices a return from the original order, so a quantity the
    // sale never contained must not become money. Asserted against the API
    // because the dialog caps the input — and the dialog is not the boundary
    // that matters.
    const api = await apiContext();
    const { product, variant } = await sellableVariant(api);
    const order = await placeOrder(api, product.id, variant.id);

    const response = await api.context.post('/api/returns', {
      headers: api.headers,
      data: {
        originalOrderId: order.id,
        items: [{ originalOrderItemId: order.items[0].id, returnQuantity: 99 }],
        reasonCode: 'defective',
        refundMethod: 'cash',
        restockItems: true,
      },
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);

    expect(await returnsForOrder(api, order.id)).toHaveLength(0);

    await api.context.dispose();
  });

  test('opens the returns dialog without a console error', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });

    await page.goto('/pos');
    await page.waitForSelector('.grid > *', { timeout: 15_000 });
    await page.getByRole('button', { name: /Returns/i }).first().click();
    await page.getByRole('tab', { name: /^Search$/i }).click();
    await expect(page.getByPlaceholder(/Enter receipt # or order ID/i)).toBeVisible({
      timeout: 10_000,
    });

    expect(problems).toEqual([]);
  });
});
