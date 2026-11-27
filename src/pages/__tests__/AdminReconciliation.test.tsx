import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Unreconciled charges: card money taken with no sale recorded against it.
 *
 * The screen has three actions and every one of them moves or settles real
 * money, so the tests check which charge each action is sent for, what the row
 * says the charge was, and that a row without a processor reference cannot be
 * refunded or re-checked.
 */

const api = vi.hoisted(() => ({ list: vi.fn(), recheck: vi.fn(), refund: vi.fn(), dismiss: vi.fn() }));

vi.mock('@/lib/api/reconciliation', () => ({ reconciliationApi: api }));

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

const { default: AdminReconciliation } = await import('../admin/AdminReconciliation');

const NOW = Date.now();

const payment = (overrides: Record<string, unknown>) => ({
  id: 'pa1',
  chargeId: 'ch_123',
  amountCents: 4050,
  currency: 'USD',
  status: 'authorized',
  registerId: null,
  cashierUserId: null,
  orderId: null,
  failureReason: null,
  cartSnapshot: { items: [{ quantity: 2 }, { quantity: 1 }] },
  createdAt: NOW - 30 * 60_000,
  updatedAt: NOW,
  ...overrides,
});

const PAYMENTS = [
  payment({}),
  payment({ id: 'pa2', chargeId: null, status: 'pending', amountCents: 100, cartSnapshot: null, createdAt: NOW - 3 * 3_600_000 }),
  payment({ id: 'pa3', chargeId: 'ch_9', status: 'failed', cartSnapshot: { items: [{ quantity: 1 }] }, createdAt: NOW - 2 * 86_400_000 }),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminReconciliation />
    </QueryClientProvider>
  );
}

const rowFor = async (text: string) => (await screen.findByText(text)).closest('tr')!;

beforeEach(() => {
  vi.clearAllMocks();
  toasts.length = 0;
  api.list.mockResolvedValue(PAYMENTS);
  api.recheck.mockResolvedValue({ status: 'approved', attempt: null });
  api.refund.mockResolvedValue({ refundId: 're_1', status: 'succeeded' });
  api.dismiss.mockResolvedValue(undefined);
});

const TIMEOUT = 20_000;

describe('AdminReconciliation list', () => {
  it('shows the amount in dollars, what it was for, and how long it has waited', async () => {
    renderPage();

    const row = await rowFor('ch_123');
    expect(within(row).getByText('$40.50')).toBeTruthy();
    expect(within(row).getByText('2 lines, 3 items')).toBeTruthy();
    expect(within(row).getByText('30m ago')).toBeTruthy();
    expect(within(row).getByText('Charged, no sale')).toBeTruthy();
  }, TIMEOUT);

  it('says plainly when there is no cart, no processor reference, or the outcome is unknown', async () => {
    renderPage();

    const row = await rowFor('never sent');
    expect(within(row).getByText('No cart recorded')).toBeTruthy();
    expect(within(row).getByText('Outcome unknown')).toBeTruthy();
    expect(within(row).getByText('3h ago')).toBeTruthy();
  }, TIMEOUT);

  it('shows an unrecognised status by its own name, and ages in days', async () => {
    renderPage();

    const row = await rowFor('ch_9');
    expect(within(row).getByText('failed')).toBeTruthy();
    expect(within(row).getByText('1 line, 1 item')).toBeTruthy();
    expect(within(row).getByText('2d ago')).toBeTruthy();
  }, TIMEOUT);

  it('will not refund or re-check a charge the processor never saw', async () => {
    renderPage();

    const row = await rowFor('never sent');
    expect(within(row).getByRole('button', { name: 'Refund' })).toHaveProperty('disabled', true);
    expect(within(row).getByRole('button', { name: 'Re-check' })).toHaveProperty('disabled', true);
    expect(within(row).getByRole('button', { name: 'Dismiss' })).toHaveProperty('disabled', false);
  }, TIMEOUT);

  it('says nothing needs reconciling when the list is empty', async () => {
    api.list.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Nothing to reconcile')).toBeTruthy();
  }, TIMEOUT);

  it('shows the load error rather than an empty list', async () => {
    api.list.mockRejectedValue(new Error('forbidden'));
    renderPage();

    expect(await screen.findByText('forbidden')).toBeTruthy();
  }, TIMEOUT);
});

describe('AdminReconciliation actions', () => {
  it('re-checks the charge and reports the processor\'s answer', async () => {
    renderPage();

    fireEvent.click(within(await rowFor('ch_123')).getByRole('button', { name: 'Re-check' }));

    await waitFor(() => expect(api.recheck).toHaveBeenCalledWith('pa1'));
    await waitFor(() =>
      expect(toasts.at(-1)).toMatchObject({ description: 'The processor reports this payment as approved.' })
    );
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  }, TIMEOUT);

  it('reports a failed re-check', async () => {
    api.recheck.mockRejectedValue(new Error('stripe timeout'));
    renderPage();

    fireEvent.click(within(await rowFor('ch_123')).getByRole('button', { name: 'Re-check' }));

    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: 'Could not check', description: 'stripe timeout' }));
  }, TIMEOUT);

  it('refunds the charge on its row and refreshes the list', async () => {
    renderPage();

    fireEvent.click(within(await rowFor('ch_123')).getByRole('button', { name: 'Refund' }));

    await waitFor(() => expect(api.refund).toHaveBeenCalledWith('pa1'));
    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: 'Refunded' }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  }, TIMEOUT);

  it('says a refund failed rather than that it went through', async () => {
    api.refund.mockRejectedValue(new Error('charge already refunded'));
    renderPage();

    fireEvent.click(within(await rowFor('ch_123')).getByRole('button', { name: 'Refund' }));

    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: 'Refund failed', description: 'charge already refunded' }));
  }, TIMEOUT);

  it('dismisses only with a reason, and sends it trimmed', async () => {
    renderPage();
    fireEvent.click(within(await rowFor('never sent')).getByRole('button', { name: 'Dismiss' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Mark resolved' });
    expect(confirm).toHaveProperty('disabled', true);

    fireEvent.change(within(dialog).getByPlaceholderText(/rung again/i), { target: { value: '   ' } });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(within(dialog).getByPlaceholderText(/rung again/i), { target: { value: '  Rung on lane 2  ' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(api.dismiss).toHaveBeenCalledWith('pa2', 'Rung on lane 2'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toasts.at(-1)).toMatchObject({ title: 'Marked as resolved' });
  }, TIMEOUT);

  it('keeps the dialog open when a dismissal fails', async () => {
    api.dismiss.mockRejectedValue(new Error('conflict'));
    renderPage();
    fireEvent.click(within(await rowFor('ch_123')).getByRole('button', { name: 'Dismiss' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText(/rung again/i), { target: { value: 'dup' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark resolved' }));

    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: 'Could not dismiss', description: 'conflict' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  }, TIMEOUT);

  it('cancels a dismissal without calling the server', async () => {
    renderPage();
    fireEvent.click(within(await rowFor('ch_123')).getByRole('button', { name: 'Dismiss' }));

    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.dismiss).not.toHaveBeenCalled();
  }, TIMEOUT);
});
