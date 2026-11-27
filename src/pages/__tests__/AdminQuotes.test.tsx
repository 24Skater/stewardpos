import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

/** Quotes: status counts and filters, the detail dialog, workflow transitions, delete. */

const item = { id: 'i1', description: 'Studio hour', serviceName: 'Recording', quantity: 2, unitPrice: 50, lineTotal: 100 };
const QUOTES = [
  { id: 'draft-0001-aaaa', customerName: 'Ann Lee', customerEmail: 'ann@x.test', status: 'draft', subtotal: 100, taxTotal: 8, total: 108, notes: 'Weekend rate', createdAt: 0, items: [item] },
  { id: 'sent-0002-bbbb', customerName: 'Bo Diaz', status: 'sent', subtotal: 50, taxTotal: 0, total: 50, createdAt: 0, items: [] },
  { id: 'done-0003-cccc', status: 'completed', subtotal: 10, taxTotal: 0, total: 10, createdAt: 0, items: [] },
  { id: 'rej-0004-dddd', customerName: 'Cy', status: 'rejected', subtotal: 1, taxTotal: 0, total: 1, createdAt: 0, items: [] },
];

const quotesApi = { list: vi.fn(), setStatus: vi.fn(), remove: vi.fn() };
vi.mock('@/lib/api', () => ({ quotesApi }));

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn(), toasts: [] }),
}));
vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { default: AdminQuotes } = await import('../admin/AdminQuotes');

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminQuotes />
    </MemoryRouter>
  );
}

const rowFor = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

async function openQuote(customer: string) {
  renderPage();
  await screen.findByText(customer);
  fireEvent.click(within(rowFor(customer)).getAllByRole('button')[0]);
  return screen.findByRole('dialog');
}

function openTab(dialog: HTMLElement, name: RegExp) {
  fireEvent.mouseDown(within(dialog).getByRole('tab', { name }), { button: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  quotesApi.list.mockResolvedValue(QUOTES);
  quotesApi.setStatus.mockImplementation(async (id: string, status: string) => ({ ...QUOTES.find((q) => q.id === id), status }));
  quotesApi.remove.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminQuotes', () => {
  it('lists quotes with walk-in fallbacks and per-status counts', async () => {
    renderPage();

    expect(await screen.findByText('Ann Lee')).toBeInTheDocument();
    expect(screen.getByText('Walk-in')).toBeInTheDocument();
    expect(screen.getByText('draft-00...')).toBeInTheDocument();
    expect(within(rowFor('Ann Lee')).getByText('1 items')).toBeInTheDocument();
    expect(within(rowFor('Ann Lee')).getByText('$108.00')).toBeInTheDocument();
    const draftCard = screen.getAllByText('Draft').find((el) => el.tagName === 'P') as HTMLElement;
    expect(draftCard.previousElementSibling).toHaveTextContent('1');
  });

  it('filters by a status card, and clicking it again clears the filter', async () => {
    renderPage();
    await screen.findByText('Ann Lee');
    const sentCard = screen.getAllByText('Sent').find((el) => el.tagName === 'P') as HTMLElement;

    fireEvent.click(sentCard);
    expect(screen.queryByText('Ann Lee')).not.toBeInTheDocument();
    expect(screen.getByText('Bo Diaz')).toBeInTheDocument();

    fireEvent.click(sentCard);
    expect(screen.getByText('Ann Lee')).toBeInTheDocument();
  });

  it('searches by customer email or quote id', async () => {
    renderPage();
    await screen.findByText('Ann Lee');
    const search = screen.getByPlaceholderText(/search by customer/i);

    fireEvent.change(search, { target: { value: 'ANN@X' } });
    expect(screen.queryByText('Bo Diaz')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'done-0003' } });
    expect(screen.getByText('Walk-in')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'nobody' } });
    expect(screen.getByText('No quotes found')).toBeInTheDocument();
  });

  it('surfaces a failure to load', async () => {
    quotesApi.list.mockRejectedValue(new Error('Down'));
    renderPage();

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Down' })));
  });

  it('shows totals, notes and line items in the detail dialog', async () => {
    const dialog = await openQuote('Ann Lee');

    expect(within(dialog).getByText('Weekend rate')).toBeInTheDocument();
    expect(within(dialog).getByText('$8.00')).toBeInTheDocument();
    openTab(dialog, /items \(1\)/i);
    expect(await within(dialog).findByText('Studio hour')).toBeInTheDocument();
    expect(within(dialog).getByText('Recording')).toBeInTheDocument();
    expect(within(dialog).getByText('$50.00')).toBeInTheDocument();
  });

  it('offers only the next valid transitions and applies one', async () => {
    const dialog = await openQuote('Ann Lee');
    openTab(dialog, /workflow/i);

    expect(await within(dialog).findByRole('button', { name: /mark as sent/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /mark as cancelled/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /mark as accepted/i })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /mark as sent/i }));

    await waitFor(() => expect(quotesApi.setStatus).toHaveBeenCalledWith('draft-0001-aaaa', 'sent'));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: 'Quote status updated to Sent' }));
    // The open dialog follows the quote to its new status.
    expect(await within(dialog).findByRole('button', { name: /mark as accepted/i })).toBeInTheDocument();
  });

  it('reports a failed transition', async () => {
    quotesApi.setStatus.mockRejectedValue(new Error('Illegal transition'));
    const dialog = await openQuote('Bo Diaz');
    openTab(dialog, /workflow/i);

    fireEvent.click(await within(dialog).findByRole('button', { name: /mark as rejected/i }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Illegal transition' })));
  });

  it('says a rejected quote is final', async () => {
    const dialog = await openQuote('Cy');
    openTab(dialog, /workflow/i);

    expect(await within(dialog).findByText(/has been rejected/i)).toBeInTheDocument();
    expect(within(dialog).queryByText('Available Actions')).not.toBeInTheDocument();
  });

  it('says a completed quote is done', async () => {
    renderPage();
    await screen.findByText('Walk-in');
    fireEvent.click(within(rowFor('Walk-in')).getAllByRole('button')[0]);
    const dialog = await screen.findByRole('dialog');
    openTab(dialog, /workflow/i);

    expect(await within(dialog).findByText(/completed successfully/i)).toBeInTheDocument();
  });

  it('deletes from the dialog only after confirming', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const dialog = await openQuote('Ann Lee');

    fireEvent.click(within(dialog).getByRole('button', { name: /delete quote/i }));
    expect(quotesApi.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: /delete quote/i }));
    await waitFor(() => expect(quotesApi.remove).toHaveBeenCalledWith('draft-0001-aaaa'));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: 'Quote deleted successfully' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });

  it('reports a failed delete and Close dismisses the dialog', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    quotesApi.remove.mockRejectedValue(new Error('Locked'));
    const dialog = await openQuote('Ann Lee');

    fireEvent.click(within(dialog).getByRole('button', { name: /delete quote/i }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Locked' })));

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
