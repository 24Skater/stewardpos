import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { pdfDocs } from '@/test/fake-pdf-kit';

/**
 * Receipts: the screen a clerk uses to find a sale, send it again, print it,
 * export the day's takings and start a return against it.
 *
 * The money on this screen is the export (what an accountant receives) and the
 * return it raises (what the shop gives back), so those are asserted on the
 * figures, not on the presence of a button.
 */

vi.mock('jspdf', () => import('@/test/fake-pdf-kit').then((m) => m.jspdfModule));
vi.mock('jspdf-autotable', () => import('@/test/fake-pdf-kit').then((m) => m.autoTableModule));

const api = vi.hoisted(() => ({
  search: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  resend: vi.fn(),
  startReturn: vi.fn(),
  createReturn: vi.fn(),
  settings: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    receiptsApi: { search: api.search, list: api.list, get: api.get, resend: api.resend, startReturn: api.startReturn },
    returnsApi: { create: api.createReturn },
    adminApi: { settings: { get: api.settings } },
  };
});

const toasts: { title?: string; description?: string; variant?: string }[] = [];
vi.mock('@/hooks/use-toast', () => {
  const toast = (message: { title?: string }) => {
    toasts.push(message);
  };
  return { useToast: () => ({ toast, dismiss: () => {} }), toast };
});

vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { default: AdminReceipts } = await import('../admin/AdminReceipts');

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const CREATED = new Date(2026, 0, 15, 10).getTime();

const RECEIPT = {
  id: 'abcdef12-0000-0000-0000-000000000001',
  createdAt: CREATED,
  subtotal: 100,
  discountTotal: 0,
  taxTotal: 8,
  total: 108,
  paymentMethod: 'card',
  customerEmail: 'ada@shop.test',
  items: [
    { id: 'i1', orderId: 'o', productId: 'p1', nameSnapshot: 'Loose Leaf Tea', quantity: 2, unitPrice: 10, lineTotal: 20 },
    { id: 'i2', orderId: 'o', productId: 'p2', nameSnapshot: 'Teapot, Blue', quantity: 1, unitPrice: 80, lineTotal: 80 },
  ],
  hasReturns: true,
  returnCount: 1,
  netTotal: 88,
};

const SECOND = {
  id: 'ffff0000-0000-0000-0000-000000000002',
  createdAt: new Date(2026, 0, 20, 10).getTime(),
  subtotal: 10,
  discountTotal: 0,
  taxTotal: 0,
  total: 10,
  paymentMethod: 'cash',
};

let written = '';

beforeEach(() => {
  vi.clearAllMocks();
  toasts.length = 0;
  pdfDocs.length = 0;
  written = '';
  api.search.mockResolvedValue([RECEIPT, SECOND]);
  api.list.mockResolvedValue({ data: [SECOND], meta: { hasMore: false } });
  api.get.mockResolvedValue({ ...RECEIPT, emailHistory: [], returns: [] });
  api.settings.mockResolvedValue({ storeName: 'Corner Store', receiptShowBarcode: false });
  api.resend.mockResolvedValue({});
  api.createReturn.mockResolvedValue({ id: 'ret1' });
  api.startReturn.mockResolvedValue({
    hasReturnableItems: true,
    returnableItems: [
      { originalOrderItemId: 'i1', productId: 'p1', nameSnapshot: 'Loose Leaf Tea', originalQuantity: 2, alreadyReturned: 0, returnableQuantity: 2, unitPrice: 10, canReturn: true },
      { originalOrderItemId: 'i2', productId: 'p2', nameSnapshot: 'Teapot, Blue', originalQuantity: 1, alreadyReturned: 1, returnableQuantity: 0, unitPrice: 80, canReturn: false },
    ],
  });
  vi.stubGlobal(
    'Blob',
    class {
      constructor(parts: string[]) {
        written = parts.join('');
      }
    }
  );
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const TIMEOUT = 20_000;

async function renderLoaded() {
  render(<AdminReceipts />);
  await screen.findByText('ABCDEF12');
}

async function openReceipt() {
  await renderLoaded();
  fireEvent.click(screen.getAllByRole('button', { name: /view/i })[0]);
  return screen.findByRole('dialog');
}

describe('AdminReceipts listing', () => {
  it('asks the search endpoint for the default one-month window, since the plain list ignores filters', async () => {
    await renderLoaded();

    const query = api.search.mock.calls[0][0];
    expect(query).toMatchObject({ limit: 25, offset: 0, paymentMethod: undefined });
    expect(query.endDate - query.startDate).toBeGreaterThanOrEqual(28 * 86_400_000);
    expect(api.list).not.toHaveBeenCalled();
  }, TIMEOUT);

  it('shows the net after returns beside the original total', async () => {
    await renderLoaded();

    const row = screen.getByText('ABCDEF12').closest('tr')!;
    expect(within(row).getByText('$108.00')).toBeTruthy();
    expect(within(row).getByText('$88.00')).toBeTruthy();
    expect(within(row).getByText('1 return')).toBeTruthy();
  }, TIMEOUT);

  it('uses the plain list endpoint once every filter is cleared', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: /all time/i }));

    await waitFor(() => expect(api.list).toHaveBeenCalledWith({ limit: 25, offset: 0 }));
  }, TIMEOUT);

  it('narrows the visible rows by email as the clerk types', async () => {
    await renderLoaded();

    fireEvent.change(screen.getByPlaceholderText(/search by receipt id/i), { target: { value: 'ada@' } });

    expect(screen.queryByText('FFFF0000')).toBeNull();
    expect(screen.getByText('Showing 1 receipt')).toBeTruthy();
  }, TIMEOUT);

  it('says so when loading fails', async () => {
    api.search.mockRejectedValue(new Error('server down'));
    render(<AdminReceipts />);

    await waitFor(() => expect(toasts[0]).toMatchObject({ title: 'Error loading receipts', description: 'server down' }));
    expect(await screen.findByText('No receipts found')).toBeTruthy();
  }, TIMEOUT);

  it('pages forward when a full page came back', async () => {
    api.search.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ ...SECOND, id: `id-${i}-xxxxxxxx` })));
    render(<AdminReceipts />);
    const next = await screen.findByRole('button', { name: /next/i });

    fireEvent.click(next);

    await waitFor(() => expect(api.search).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 })));
    expect(screen.getByText('Page 2')).toBeTruthy();
  }, TIMEOUT);
});

describe('AdminReceipts export', () => {
  it('writes a CSV with every receipt, its net and an ISO timestamp', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));

    const lines = written.split('\n');
    expect(lines[0]).toBe('Receipt ID,Date,Customer Email,Payment Method,Subtotal,Tax,Total,Has Returns,Net Total');
    expect(lines[1]).toBe(`ABCDEF12,${new Date(CREATED).toISOString()},ada@shop.test,card,100,8,108,Yes,88`);
    // No net recorded falls back to the total; no email reads N/A.
    expect(lines[2]).toMatch(/^FFFF0000,.*,N\/A,cash,10,0,10,No,10$/);
    expect(toasts.at(-1)).toMatchObject({ title: 'Export complete', description: 'Downloaded CSV file' });
  }, TIMEOUT);

  it('writes a PDF covering the span of the receipts on screen', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));

    await waitFor(() => expect(pdfDocs).toHaveLength(1));
    const [doc] = pdfDocs;
    expect(doc.texts).toContain('Total Orders: 2');
    expect(doc.texts).toContain('Total Revenue: $118.00');
    expect(doc.texts).toContain(
      `${new Date(CREATED).toLocaleDateString()} - ${new Date(SECOND.createdAt).toLocaleDateString()}`
    );
  }, TIMEOUT);

  // BUG: the receipts PDF hard-codes 'Steward · Register' as the store name
  // (AdminReceipts.tsx, handleExportReceipts) even though the page has already
  // loaded the store's settings, so every exported PDF is headed with the
  // product name instead of the shop's.
  it.fails('heads the PDF with the store name from settings', async () => {
    await renderLoaded();
    await waitFor(() => expect(api.settings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));

    await waitFor(() => expect(pdfDocs).toHaveLength(1));
    expect(pdfDocs[0].texts).toContain('Corner Store');
  }, TIMEOUT);

  it('refuses to export an empty list instead of writing a blank file', async () => {
    api.search.mockResolvedValue([]);
    render(<AdminReceipts />);
    await screen.findByText('No receipts found');

    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));

    expect(written).toBe('');
    expect(toasts.at(-1)).toMatchObject({ title: 'No data to export' });
  }, TIMEOUT);
});

describe('AdminReceipts details', () => {
  it('shows the receipt lines and totals as charged', async () => {
    const dialog = await openReceipt();

    expect(within(dialog).getByText('Receipt #ABCDEF12')).toBeTruthy();
    expect(within(dialog).getByText('Loose Leaf Tea')).toBeTruthy();
    expect(within(dialog).getByText('Qty: 2 × $10.00')).toBeTruthy();
    expect(within(dialog).getByText('$108.00')).toBeTruthy();
    expect(within(dialog).getByText('Corner Store')).toBeTruthy();
  }, TIMEOUT);

  it('reports a receipt that will not load', async () => {
    api.get.mockRejectedValue(new Error('gone'));
    await renderLoaded();

    fireEvent.click(screen.getAllByRole('button', { name: /view/i })[0]);

    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: 'Error loading receipt', description: 'gone' }));
  }, TIMEOUT);

  it('resends to the address typed, defaulting to the customer on file', async () => {
    await openReceipt();
    fireEvent.click(screen.getByRole('button', { name: /send receipt/i }));
    const email = await screen.findByLabelText(/email address/i);
    expect((email as HTMLInputElement).value).toBe('ada@shop.test');

    fireEvent.change(email, { target: { value: 'grace@shop.test' } });
    fireEvent.click(screen.getAllByRole('button', { name: /send receipt/i }).at(-1)!);

    await waitFor(() => expect(api.resend).toHaveBeenCalledWith(RECEIPT.id, 'grace@shop.test'));
    expect(toasts.at(-1)).toMatchObject({ title: 'Receipt sent', description: 'Sent to grace@shop.test' });
  }, TIMEOUT);

  it('tells the clerk when a resend fails', async () => {
    api.resend.mockRejectedValue(new Error('smtp refused'));
    await openReceipt();
    fireEvent.click(screen.getByRole('button', { name: /send receipt/i }));
    await screen.findByLabelText(/email address/i);

    fireEvent.click(screen.getAllByRole('button', { name: /send receipt/i }).at(-1)!);

    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: 'Failed to send receipt', description: 'smtp refused' }));
  }, TIMEOUT);

  it('prints the receipt preview itself, with its lines and total, in its own window', async () => {
    const write = vi.fn();
    const printWindow = { document: { write, close: vi.fn(), title: '' }, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(printWindow as never);
    await openReceipt();

    fireEvent.click(screen.getByRole('button', { name: /print/i }));

    const html = write.mock.calls[0][0] as string;
    expect(html).toContain('Loose Leaf Tea');
    expect(html).toContain('$108.00');
    expect(printWindow.document.title).toBe('Receipt - ABCDEF12');
    expect(toasts).toEqual([]);
  }, TIMEOUT);

  it('says so when the browser blocks the print window', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    await openReceipt();

    fireEvent.click(screen.getByRole('button', { name: /print/i }));

    expect(toasts.at(-1)).toMatchObject({ title: 'Unable to open print window' });
  }, TIMEOUT);
});

describe('AdminReceipts returns', () => {
  async function openReturn() {
    await openReceipt();
    fireEvent.click(screen.getByRole('button', { name: /start return/i }));
    return screen.findByRole('dialog', { name: /start return/i });
  }

  it('offers only what is still returnable and estimates the refund as it is chosen', async () => {
    const dialog = await openReturn();

    expect(within(dialog).getByText('N/A')).toBeTruthy(); // the teapot already went back
    const qty = within(dialog).getByRole('spinbutton');
    fireEvent.change(qty, { target: { value: '5' } }); // more than was bought

    expect((qty as HTMLInputElement).value).toBe('2');
    expect(within(dialog).getByText('$20.00')).toBeTruthy();
  }, TIMEOUT);

  it('creates the return with the order\'s own tax rate applied', async () => {
    const dialog = await openReturn();
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '1' } });
    fireEvent.change(within(dialog).getByLabelText(/additional notes/i), { target: { value: 'Opened' } });

    fireEvent.click(within(dialog).getByRole('button', { name: /create return/i }));

    await waitFor(() => expect(api.createReturn).toHaveBeenCalled());
    const body = api.createReturn.mock.calls[0][0];
    expect(body).toMatchObject({
      originalOrderId: RECEIPT.id,
      subtotal: 10,
      total: 10.8,
      reasonCode: 'not_needed',
      reasonDetails: 'Opened',
      restockItems: true,
      items: [expect.objectContaining({ originalOrderItemId: 'i1', returnQuantity: 1, lineTotal: 10 })],
    });
    expect(body.taxTotal).toBeCloseTo(0.8);
    expect(toasts.at(-1)).toMatchObject({ title: 'Return created' });
  }, TIMEOUT);

  it('will not create an empty return', async () => {
    const dialog = await openReturn();

    fireEvent.click(within(dialog).getByRole('button', { name: /create return/i }));

    expect(api.createReturn).not.toHaveBeenCalled();
    expect(toasts.at(-1)).toMatchObject({ title: 'Select items to return' });
  }, TIMEOUT);

  it('reports a return the server refused', async () => {
    api.createReturn.mockRejectedValue(new Error('shift required'));
    const dialog = await openReturn();
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '1' } });

    fireEvent.click(within(dialog).getByRole('button', { name: /create return/i }));

    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: 'Failed to create return', description: 'shift required' }));
  }, TIMEOUT);

  it('does not open the return form when everything has gone back already', async () => {
    api.startReturn.mockResolvedValue({ hasReturnableItems: false, returnableItems: [] });
    await openReceipt();

    fireEvent.click(screen.getByRole('button', { name: /start return/i }));

    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: 'No items to return' }));
    expect(screen.queryByRole('dialog', { name: /start return/i })).toBeNull();
  }, TIMEOUT);

  it('reports a start-return the server refused', async () => {
    api.startReturn.mockRejectedValue(new Error('nope'));
    await openReceipt();

    fireEvent.click(screen.getByRole('button', { name: /start return/i }));

    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: 'Error', description: 'nope' }));
  }, TIMEOUT);
});
