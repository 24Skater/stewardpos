import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/**
 * Quick Return, at the register: find the sale, pick what came back, refund it.
 *
 * Money leaves the drawer on the strength of this dialog, so the tests pin the
 * figures it computes (refund total, the cap on quantity, the cash-approval
 * threshold) and the exact sequence of calls it makes — create, approve,
 * refund, restock — including what it tells the clerk when that sequence stops
 * halfway.
 */

const api = vi.hoisted(() => ({
  listOrders: vi.fn(),
  getOrder: vi.fn(),
  listByOrder: vi.fn(),
  create: vi.fn(),
  setStatus: vi.fn(),
  processRefund: vi.fn(),
  restock: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    ordersApi: { list: api.listOrders, get: api.getOrder },
    returnsApi: {
      listByOrder: api.listByOrder,
      create: api.create,
      setStatus: api.setStatus,
      processRefund: api.processRefund,
      restock: api.restock,
    },
  };
});

const toasts: { title?: string; description?: string }[] = [];
vi.mock('@/hooks/use-toast', () => {
  const toast = (message: { title?: string }) => {
    toasts.push(message);
  };
  return { useToast: () => ({ toast, dismiss: () => {} }), toast };
});

const { default: QuickReturnDialog } = await import('../QuickReturnDialog');

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const line = (id: string, productId: string, quantity: number, unitPrice: number, extra: Record<string, unknown> = {}) => ({
  id,
  orderId: 'o',
  productId,
  nameSnapshot: `Item ${id}`,
  quantity,
  unitPrice,
  lineTotal: quantity * unitPrice,
  ...extra,
});

const ORDER = {
  id: 'fce60f0e-1111-2222-3333-444444444444',
  createdAt: new Date(2026, 0, 15, 14, 30).getTime(),
  subtotal: 140,
  discountTotal: 0,
  taxTotal: 0,
  total: 140,
  paymentMethod: 'cash',
  customerEmail: 'ada@shop.test',
  items: [line('a', 'p1', 3, 20, { variantId: 'v1', size: 'M' }), line('b', 'p2', 1, 80)],
};

const OLDER = { ...ORDER, id: '0ldd0000-aaaa', createdAt: ORDER.createdAt - 86_400_000, total: 5, customerEmail: undefined };

const onClose = vi.fn();
const onComplete = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  toasts.length = 0;
  api.listOrders.mockResolvedValue([OLDER, ORDER]);
  api.getOrder.mockResolvedValue(ORDER);
  api.listByOrder.mockResolvedValue([]);
  api.create.mockImplementation(async (body: { total: number }) => ({ id: 'ret-1', total: body.total }));
  api.setStatus.mockResolvedValue({});
  api.processRefund.mockResolvedValue({});
  api.restock.mockResolvedValue({});
});

const TIMEOUT = 20_000;

function renderOpen() {
  return render(<QuickReturnDialog open onClose={onClose} onComplete={onComplete} />);
}

/** Open the dialog and pick ORDER from the recent receipts. */
async function pickOrder() {
  renderOpen();
  fireEvent.click(await screen.findByText('#FCE60F0E'));
  await screen.findByText('Select items to return');
}

const checkboxes = () => screen.getAllByRole('checkbox');
const quantities = () => screen.getAllByRole('spinbutton') as HTMLInputElement[];

async function chooseRefundMethod(label: string) {
  fireEvent.click(screen.getAllByRole('combobox')[1]);
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

describe('QuickReturnDialog finding the sale', () => {
  it('lists recent receipts newest first with their totals', async () => {
    renderOpen();

    const first = await screen.findByText('#FCE60F0E');
    const buttons = screen.getAllByRole('button').filter((b) => b.textContent?.startsWith('#'));
    expect(buttons[0]).toBe(first.closest('button'));
    expect(within(first.closest('button')!).getByText('$140.00')).toBeTruthy();
  }, TIMEOUT);

  it('says there are no recent orders when the till has none', async () => {
    api.listOrders.mockResolvedValue([]);
    renderOpen();

    expect(await screen.findByText('No recent orders found')).toBeTruthy();
  }, TIMEOUT);

  it('finds a sale by the eight characters printed on the receipt', async () => {
    renderOpen();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /search/i }), { button: 0 });
    const input = await screen.findByPlaceholderText(/receipt #/i);

    fireEvent.change(input, { target: { value: 'fce60f0e' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(api.getOrder).toHaveBeenCalledWith(ORDER.id));
    expect(await screen.findByText('Order #FCE60F0E')).toBeTruthy();
  }, TIMEOUT);

  it('says the order was not found rather than picking another', async () => {
    renderOpen();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /search/i }), { button: 0 });
    fireEvent.change(await screen.findByPlaceholderText(/receipt #/i), { target: { value: 'NOPE9999' } });

    fireEvent.click(screen.getByRole('button', { name: 'Find' }));

    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: 'Order not found' }));
    expect(api.getOrder).not.toHaveBeenCalled();
  }, TIMEOUT);

  it('reports an order that fails to load', async () => {
    api.getOrder.mockRejectedValue(new Error('offline'));
    renderOpen();

    fireEvent.click(await screen.findByText('#FCE60F0E'));

    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: 'Failed to load order', description: 'offline' }));
  }, TIMEOUT);
});

describe('QuickReturnDialog choosing what came back', () => {
  it('caps each line at what was bought less what has already gone back', async () => {
    api.listByOrder.mockResolvedValue([{ id: 'r0', items: [{ productId: 'p1', variantId: 'v1', returnQuantity: 1 }] }]);
    await pickOrder();

    expect(screen.getByText('1 already returned')).toBeTruthy();
    expect(screen.getByText('1 previous return(s)')).toBeTruthy();
    fireEvent.click(checkboxes()[0]);
    fireEvent.change(quantities()[0], { target: { value: '9' } });

    expect(quantities()[0].value).toBe('2');
    expect(screen.getByText('$40.00')).toBeTruthy();
  }, TIMEOUT);

  it('disables a line that has been returned in full', async () => {
    api.listByOrder.mockResolvedValue([{ id: 'r0', items: [{ productId: 'p2', returnQuantity: 1 }] }]);
    await pickOrder();

    expect(checkboxes()[1]).toHaveProperty('disabled', true);
  }, TIMEOUT);

  // BUG: QuickReturnDialog.selectOrder keys already-returned quantities by
  // productId+variantId, not by order line. When the same product is rung on two
  // lines, a return against one line is counted against both, so the second
  // line — never returned — is blocked.
  it.fails('counts a prior return only against the line it came from', async () => {
    api.getOrder.mockResolvedValue({ ...ORDER, items: [line('a', 'p1', 1, 20), line('b', 'p1', 1, 20)] });
    api.listByOrder.mockResolvedValue([{ id: 'r0', items: [{ productId: 'p1', returnQuantity: 1 }] }]);
    await pickOrder();

    expect(checkboxes().filter((box) => !(box as HTMLButtonElement).disabled)).toHaveLength(1);
  }, TIMEOUT);

  it('totals only the ticked lines at their returned quantities', async () => {
    await pickOrder();
    fireEvent.click(checkboxes()[0]);
    fireEvent.change(quantities()[0], { target: { value: '2' } });

    expect(screen.getByText('1 item(s)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refund $40.00' })).toBeTruthy();
    expect(screen.getByText('Will be processed immediately')).toBeTruthy();
  }, TIMEOUT);

  it('holds a cash refund over $250 for a manager, but not the same amount on a card', async () => {
    api.getOrder.mockResolvedValue({ ...ORDER, items: [line('a', 'p1', 1, 260)] });
    await pickOrder();
    fireEvent.click(checkboxes()[0]);

    expect(screen.getByText(/cash refunds over \$250 require manager approval/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit for Approval' })).toBeTruthy();

    await chooseRefundMethod('Card');

    expect(screen.getByRole('button', { name: 'Refund $260.00' })).toBeTruthy();
  }, TIMEOUT);

  it('goes back to the search step', async () => {
    await pickOrder();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(await screen.findByText(/enter the receipt number/i)).toBeTruthy();
  }, TIMEOUT);
});

describe('QuickReturnDialog processing', () => {
  it('creates, approves, refunds and restocks an under-threshold cash return', async () => {
    await pickOrder();
    fireEvent.click(checkboxes()[0]);
    fireEvent.change(quantities()[0], { target: { value: '2' } });
    fireEvent.change(screen.getByPlaceholderText(/additional details/i), { target: { value: 'Too small' } });

    fireEvent.click(screen.getByRole('button', { name: 'Refund $40.00' }));

    await waitFor(() => expect(api.restock).toHaveBeenCalledWith('ret-1'));
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        originalOrderId: ORDER.id,
        customerEmail: 'ada@shop.test',
        subtotal: 40,
        total: 40,
        refundMethod: 'cash',
        reasonCode: 'not_needed',
        reasonDetails: 'Too small',
        items: [
          expect.objectContaining({ originalOrderItemId: 'a', variantId: 'v1', size: 'M', originalQuantity: 3, returnQuantity: 2, lineTotal: 40 }),
        ],
      })
    );
    expect(api.setStatus).toHaveBeenCalledWith('ret-1', 'approved');
    expect(api.processRefund).toHaveBeenCalledWith('ret-1', { refundMethod: 'cash', amount: 40 });
    expect(toasts.at(-1)).toMatchObject({ title: 'Return processed!', description: 'Refund of $40.00 via cash' });
    expect(onComplete).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  }, TIMEOUT);

  it('creates an over-threshold cash return but moves no money', async () => {
    api.getOrder.mockResolvedValue({ ...ORDER, items: [line('a', 'p1', 1, 260)] });
    await pickOrder();
    fireEvent.click(checkboxes()[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));

    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: 'Return created - Needs approval' }));
    expect(api.create).toHaveBeenCalled();
    expect(api.setStatus).not.toHaveBeenCalled();
    expect(api.processRefund).not.toHaveBeenCalled();
  }, TIMEOUT);

  it('refunds a large amount straight away to store credit', async () => {
    api.getOrder.mockResolvedValue({ ...ORDER, items: [line('a', 'p1', 1, 260)] });
    await pickOrder();
    fireEvent.click(checkboxes()[0]);
    await chooseRefundMethod('Store Credit');

    fireEvent.click(screen.getByRole('button', { name: 'Refund $260.00' }));

    await waitFor(() => expect(api.processRefund).toHaveBeenCalledWith('ret-1', { refundMethod: 'store_credit', amount: 260 }));
  }, TIMEOUT);

  it('says the return is saved but unpaid when the refund is declined', async () => {
    // Saying "failed" here would send the clerk to raise a second return for
    // goods already recorded as coming back.
    api.processRefund.mockRejectedValue(new Error('Card declined.'));
    await pickOrder();
    fireEvent.click(checkboxes()[0]);

    fireEvent.click(screen.getByRole('button', { name: /^Refund \$/ }));

    await waitFor(() =>
      expect(toasts.at(-1)).toMatchObject({
        title: 'Return saved, but the refund did not go through',
        description: 'Card declined. Settle it from Returns in the admin area.',
      })
    );
    expect(onComplete).not.toHaveBeenCalled();
  }, TIMEOUT);

  it('says the return failed when nothing was created', async () => {
    api.create.mockRejectedValue(new Error('Register requires a cashier'));
    await pickOrder();
    fireEvent.click(checkboxes()[0]);

    fireEvent.click(screen.getByRole('button', { name: /^Refund \$/ }));

    await waitFor(() =>
      expect(toasts.at(-1)).toMatchObject({ title: 'Failed to process return', description: 'Register requires a cashier' })
    );
    expect(api.processRefund).not.toHaveBeenCalled();
  }, TIMEOUT);

  // BUG: QuickReturnDialog.processReturn computes the refund with taxRate = 0
  // and passes that pre-tax figure as `amount` to processRefund. The server
  // reprices the return including its share of the order's tax
  // (backend/src/services/returnPricing.ts), so on any taxed order the refund
  // is treated as *partial* and the customer is short the tax. The refund
  // should be the server-priced return total (or omit `amount`).
  it.fails('refunds the total the server priced the return at, tax included', async () => {
    api.getOrder.mockResolvedValue({ ...ORDER, subtotal: 100, taxTotal: 8, total: 108, items: [line('a', 'p1', 1, 100)] });
    api.create.mockResolvedValue({ id: 'ret-1', total: 108 });
    await pickOrder();
    fireEvent.click(checkboxes()[0]);

    fireEvent.click(screen.getByRole('button', { name: /^Refund \$/ }));

    await waitFor(() => expect(api.processRefund).toHaveBeenCalled());
    expect(api.processRefund.mock.calls[0][1].amount ?? 108).toBe(108);
  }, TIMEOUT);
});
