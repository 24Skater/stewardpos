import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * Returns & Refunds: where a manager approves, rejects, refunds and restocks.
 *
 * Each action is one API call carrying the manager's decision, so the tests
 * assert the call that leaves the page — which return, what status, how much
 * money by which method — and the toast the manager sees afterwards.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  get: vi.fn(),
  setStatus: vi.fn(),
  processRefund: vi.fn(),
  restock: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, returnsApi: api };
});

const toasts: { title?: string; description?: string }[] = [];
vi.mock('@/hooks/use-toast', () => {
  const toast = (message: { title?: string }) => {
    toasts.push(message);
  };
  return { useToast: () => ({ toast, dismiss: () => {} }), toast };
});

vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { default: AdminReturns } = await import('../admin/AdminReturns');

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const STATS = {
  totalReturns: 4,
  completedReturns: 2,
  pendingReturns: 1,
  rejectedReturns: 1,
  totalRefunded: 123.4,
  totalStoreCredits: 20,
  uniqueCustomers: 3,
};

const base = {
  id: 'ret-1',
  originalOrderId: 'order-abcdef123',
  returnNumber: 'RET-0001',
  returnType: 'return',
  status: 'pending',
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@shop.test',
  subtotal: 40,
  taxTotal: 3.2,
  total: 43.2,
  refundStatus: 'pending',
  storeCreditAmount: 0,
  reasonCode: 'defective',
  restockItems: true,
  restockingFee: 0,
  createdAt: new Date(2026, 0, 15, 10).getTime(),
  updatedAt: 0,
  items: [
    { id: 'it1', productId: 'p', nameSnapshot: 'Kettle', size: 'L', color: 'Red', originalQuantity: 2, returnQuantity: 1, unitPrice: 40, lineTotal: 40, condition: 'damaged', restocked: false },
  ],
};

const OTHER = { ...base, id: 'ret-2', returnNumber: 'RET-0002', customerName: undefined, customerEmail: undefined, originalOrderId: 'zzz', total: 5 };

beforeEach(() => {
  vi.clearAllMocks();
  toasts.length = 0;
  api.list.mockResolvedValue([base, OTHER]);
  api.stats.mockResolvedValue(STATS);
  api.get.mockResolvedValue(base);
  api.setStatus.mockResolvedValue({});
  api.processRefund.mockResolvedValue({});
  api.restock.mockResolvedValue({});
});

const TIMEOUT = 20_000;

async function renderLoaded() {
  render(<AdminReturns />);
  await screen.findByText('RET-0001');
}

async function openDetails(detail: Record<string, unknown> = {}) {
  api.get.mockResolvedValue({ ...base, ...detail });
  await renderLoaded();
  fireEvent.click(screen.getAllByRole('button', { name: /view/i })[0]);
  return screen.findByRole('dialog');
}

/** Radix Tabs switch on mousedown, not click. */
function openTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });
}

async function openActions(detail: Record<string, unknown> = {}) {
  await openDetails(detail);
  openTab(/actions/i);
}

describe('AdminReturns overview', () => {
  it('shows the refund totals and counts from the server', async () => {
    await renderLoaded();

    expect(await screen.findByText('$123.40')).toBeTruthy();
    expect(screen.getByText('Store credits: $20.00')).toBeTruthy();
    expect(screen.getByText('2 returns found')).toBeTruthy();
  }, TIMEOUT);

  it('lists each return with its amount and labels an anonymous one Guest', async () => {
    await renderLoaded();

    const row = screen.getByText('RET-0002').closest('tr')!;
    expect(within(row).getByText('Guest')).toBeTruthy();
    expect(within(row).getByText('No email')).toBeTruthy();
    expect(within(row).getByText('$5.00')).toBeTruthy();
  }, TIMEOUT);

  it('searches by order id as well as return number and customer', async () => {
    await renderLoaded();

    fireEvent.change(screen.getByPlaceholderText(/search by return/i), { target: { value: 'ABCDEF' } });

    expect(screen.queryByText('RET-0002')).toBeNull();
    expect(screen.getByText('1 return found')).toBeTruthy();
  }, TIMEOUT);

  it('asks the server for a status rather than filtering the page', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('combobox', { name: /filter returns by status/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'Pending' }));

    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ status: 'pending' }));
  }, TIMEOUT);

  it('shows an empty state and an error when loading fails', async () => {
    api.list.mockRejectedValue(new Error('db offline'));
    render(<AdminReturns />);

    await waitFor(() => expect(toasts[0]).toMatchObject({ title: 'Error loading returns', description: 'db offline' }));
    expect(await screen.findByText('No returns found')).toBeTruthy();
  }, TIMEOUT);
});

describe('AdminReturns details', () => {
  it('breaks the refund into subtotal, tax and total and names the reason', async () => {
    const dialog = await openDetails({ restockingFee: 2.5, storeCreditCode: 'SC-9', storeCreditAmount: 43.2, internalNotes: 'Checked box' });

    expect(within(dialog).getByText('$40.00')).toBeTruthy();
    expect(within(dialog).getByText('$3.20')).toBeTruthy();
    expect(within(dialog).getByText('Defective Product')).toBeTruthy();
    expect(within(dialog).getByText('$2.50')).toBeTruthy();
    expect(within(dialog).getByText('SC-9')).toBeTruthy();
    expect(within(dialog).getByText('Checked box')).toBeTruthy();
  }, TIMEOUT);

  it('lists the returned lines with quantities and condition', async () => {
    const dialog = await openDetails();

    openTab(/items/i);

    const row = within(dialog).getByText('Kettle').closest('tr')!;
    expect(within(row).getByText('damaged')).toBeTruthy();
    expect(within(row).getAllByText('$40.00')).toHaveLength(2);
    expect(within(row).getByText('No')).toBeTruthy();
  }, TIMEOUT);

  it('reports details that will not load', async () => {
    api.get.mockRejectedValue(new Error('missing'));
    await renderLoaded();

    fireEvent.click(screen.getAllByRole('button', { name: /view/i })[0]);

    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: 'Error loading return details' }));
  }, TIMEOUT);
});

describe('AdminReturns actions', () => {
  async function confirm() {
    const action = await screen.findAllByRole('dialog');
    fireEvent.click(within(action.at(-1)!).getByRole('button', { name: 'Confirm' }));
  }

  it('approves a pending return with the manager\'s note', async () => {
    await openActions();
    fireEvent.click(screen.getByRole('button', { name: /approve return/i }));
    fireEvent.change(await screen.findByLabelText(/notes/i), { target: { value: 'Receipt checked' } });

    await confirm();

    await waitFor(() => expect(api.setStatus).toHaveBeenCalledWith('ret-1', 'approved', 'Receipt checked'));
    expect(toasts.at(-1)).toMatchObject({ title: 'Return approved' });
    // The list, stats and open detail are refreshed so the screen matches.
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  }, TIMEOUT);

  it('rejects a pending return', async () => {
    await openActions();
    fireEvent.click(screen.getByRole('button', { name: /reject return/i }));

    await confirm();

    await waitFor(() => expect(api.setStatus).toHaveBeenCalledWith('ret-1', 'rejected', ''));
  }, TIMEOUT);

  it('refunds the full total by the original payment method unless changed', async () => {
    await openActions({ status: 'approved' });
    fireEvent.click(screen.getByRole('button', { name: /process refund/i }));
    const amount = (await screen.findByLabelText(/refund amount/i)) as HTMLInputElement;
    expect(amount.value).toBe('43.2');

    await confirm();

    await waitFor(() =>
      expect(api.processRefund).toHaveBeenCalledWith('ret-1', { refundMethod: 'original_payment', amount: 43.2, notes: '' })
    );
    expect(toasts.at(-1)).toMatchObject({ title: 'Refund processed successfully' });
  }, TIMEOUT);

  it('sends a partial refund amount by the chosen method', async () => {
    await openActions({ status: 'approved' });
    fireEvent.click(screen.getByRole('button', { name: /process refund/i }));
    fireEvent.change(await screen.findByLabelText(/refund amount/i), { target: { value: '10.50' } });
    fireEvent.click(screen.getByRole('combobox', { name: /refund method/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'Store Credit' }));

    await confirm();

    await waitFor(() =>
      expect(api.processRefund).toHaveBeenCalledWith('ret-1', { refundMethod: 'store_credit', amount: 10.5, notes: '' })
    );
  }, TIMEOUT);

  it('leaves the amount to the server — a full refund — when the field is cleared', async () => {
    await openActions({ status: 'approved' });
    fireEvent.click(screen.getByRole('button', { name: /process refund/i }));
    fireEvent.change(await screen.findByLabelText(/refund amount/i), { target: { value: '' } });

    await confirm();

    await waitFor(() => expect(api.processRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({ amount: undefined })));
  }, TIMEOUT);

  it('says the action failed, and keeps the dialog open, when the server refuses a refund', async () => {
    api.processRefund.mockRejectedValue(new Error("A refund cannot exceed the return's total of $43.20"));
    await openActions({ status: 'approved' });
    fireEvent.click(screen.getByRole('button', { name: /process refund/i }));
    fireEvent.change(await screen.findByLabelText(/refund amount/i), { target: { value: '500' } });

    await confirm();

    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: 'Action failed', description: expect.stringContaining('$43.20') }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
  }, TIMEOUT);

  it('restocks an approved return with unrestocked items', async () => {
    await openActions({ status: 'approved', refundStatus: 'processed' });
    fireEvent.click(screen.getByRole('button', { name: /restock items/i }));

    await confirm();

    await waitFor(() => expect(api.restock).toHaveBeenCalledWith('ret-1'));
    expect(toasts.at(-1)).toMatchObject({ title: 'Items restocked successfully' });
  }, TIMEOUT);

  it('completes a return once the refund has gone out, and offers no second refund', async () => {
    await openActions({ status: 'approved', refundStatus: 'processed' });
    expect(screen.queryByRole('button', { name: /process refund/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /mark as completed/i }));

    await confirm();

    await waitFor(() => expect(api.setStatus).toHaveBeenCalledWith('ret-1', 'completed', ''));
  }, TIMEOUT);

  it.each([
    ['completed', 'This return has been completed'],
    ['rejected', 'This return was rejected'],
  ])('offers no actions on a %s return', async (status, message) => {
    await openActions({ status });

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve|refund|restock/i })).toBeNull();
  }, TIMEOUT);
});
