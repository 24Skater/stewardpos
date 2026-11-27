import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { pdfDocs } from '@/test/fake-pdf-kit';

/**
 * What the Exports screen actually writes.
 *
 * `adminPages.actions.test.tsx` proves the buttons reach the API and pick the
 * right toast against an empty store. This file loads a small, known store and
 * reads the files back: the CSV rows, the date window they were cut to, the
 * file names, and the words on the PDFs.
 */

vi.mock('jspdf', () => import('@/test/fake-pdf-kit').then((m) => m.jspdfModule));
vi.mock('jspdf-autotable', () => import('@/test/fake-pdf-kit').then((m) => m.autoTableModule));

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

const item = (name: string, quantity: number, lineTotal: number) => ({
  id: `${name}-${quantity}`,
  orderId: 'o',
  productId: name,
  nameSnapshot: name,
  quantity,
  unitPrice: lineTotal / quantity,
  lineTotal,
});

const order = (id: string, createdAt: number, total: number, extra: Record<string, unknown> = {}) => ({
  id,
  createdAt,
  subtotal: total,
  discountTotal: 0,
  taxTotal: 0,
  total,
  paymentMethod: 'cash',
  ...extra,
});

const ORDERS = [
  order('o-early', at(2026, 0, 1), 1000, { items: [item('Tea', 1, 1000)] }),
  order('o-in-1', at(2026, 0, 10), 30, { customerEmail: 'ada@shop.test', items: [item('Tea', 2, 20), item('Mug', 1, 10)] }),
  order('o-in-2', at(2026, 0, 20), 15, { items: [item('Mug', 1, 15)] }),
  order('o-late', at(2026, 1, 25), 2000, { items: [item('Tea', 1, 2000)] }),
];

const CUSTOMERS = [
  { id: 'c1', name: 'Lovelace, Ada', email: 'ada@shop.test', city: 'London', createdAt: at(2025, 5, 1) },
  { id: 'c2', name: 'Grace Hopper', email: 'grace@shop.test', createdAt: at(2025, 5, 1) },
];

const QUOTES = [
  { id: 'q1', customerId: 'c2', status: 'completed', subtotal: 50, taxTotal: 0, total: 50, createdAt: at(2026, 0, 12), items: [{ id: 'qi', serviceId: 's1', description: 'Repair', quantity: 1, unitPrice: 50, lineTotal: 50 }] },
];

const SERVICES = [{ id: 's1', name: 'Repair', category: 'Fix', basePrice: 50, unitType: 'job', isActive: true }];

const PRODUCTS = [
  { id: 'p1', name: 'Shirt', category: 'Tops', basePrice: 20, variants: [{ id: 'v1', size: 'M', color: 'Red', sku: 'SH-M', stock: 3, enabled: true }] },
];

const RETURNS = [
  { id: 'r1', returnNumber: 'RET-1', returnType: 'return', status: 'completed', customerEmail: 'ada@shop.test', total: 10, refundStatus: 'processed', reasonCode: 'defective', createdAt: at(2026, 0, 11) },
  { id: 'r2', returnNumber: 'RET-2', returnType: 'return', status: 'pending', total: 4, refundStatus: 'pending', createdAt: at(2026, 1, 26) },
];

const REGISTER = {
  registerId: 'r-main', displayCode: 'MAIN-01', name: 'Front Counter', locationId: 'l', locationName: 'Main Street',
  type: 'fixed', hasCashDrawer: true, status: 'active', orderCount: 10, gross: 200, discounts: 5, tax: 15, net: 210, avgTicket: 21,
};

const api = vi.hoisted(() => ({
  orders: vi.fn(),
  quotes: vi.fn(),
  customers: vi.fn(),
  services: vi.fn(),
  products: vi.fn(),
  returns: vi.fn(),
  salesByRegister: vi.fn(),
  salesByCashier: vi.fn(),
  drawerVariance: vi.fn(),
  noSaleCounts: vi.fn(),
  settings: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    ordersApi: { list: api.orders },
    quotesApi: { list: api.quotes },
    customersApi: { list: api.customers },
    servicesApi: { list: api.services },
    productsApi: { list: api.products },
    returnsApi: { list: api.returns },
    reportsApi: {
      salesByRegister: api.salesByRegister,
      salesByCashier: api.salesByCashier,
      drawerVarianceByRegister: api.drawerVariance,
      noSaleCounts: api.noSaleCounts,
    },
    adminApi: { settings: { get: api.settings } },
  };
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

const { default: AdminExports } = await import('../admin/AdminExports');

/** Every file the page handed to the browser: its name and, for text files, its contents. */
const files: { name: string; text: string }[] = [];
let lastText = '';
const RealBlob = globalThis.Blob;

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  toasts.length = 0;
  files.length = 0;
  pdfDocs.length = 0;
  api.orders.mockResolvedValue(ORDERS);
  api.quotes.mockResolvedValue(QUOTES);
  api.customers.mockResolvedValue(CUSTOMERS);
  api.services.mockResolvedValue(SERVICES);
  api.products.mockResolvedValue(PRODUCTS);
  api.returns.mockResolvedValue(RETURNS);
  api.salesByRegister.mockResolvedValue({ registers: [REGISTER] });
  api.salesByCashier.mockResolvedValue([{ cashierUserId: 'u1', cashierName: 'Sam', orderCount: 3, net: 30, avgTicket: 10 }]);
  api.drawerVariance.mockResolvedValue([{ displayCode: 'MAIN-01', name: 'Front', sessionCount: 2, shortCount: 1, totalVariance: -5, worstVariance: -5 }]);
  api.noSaleCounts.mockResolvedValue([{ displayCode: 'MAIN-01', name: 'Front', noSaleCount: 7 }]);
  api.settings.mockResolvedValue({ storeName: 'Corner Store' });

  vi.stubGlobal(
    'Blob',
    class extends RealBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        lastText = parts.every((p) => typeof p === 'string') ? parts.join('') : '';
      }
    }
  );
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:mock' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    files.push({ name: this.download, text: lastText });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const TIMEOUT = 20_000;

async function renderLoaded() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AdminExports />
    </QueryClientProvider>
  );
  await waitFor(() => expect(api.returns).toHaveBeenCalled());
  // Let the six list responses land in state before anything is exported.
  await waitFor(() => expect(toasts).toEqual([]));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function openTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });
}

function setRange(start: string, end: string) {
  fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: start } });
  fireEvent.change(screen.getByLabelText('End Date'), { target: { value: end } });
}

async function exportAs(label: string) {
  fireEvent.click(await screen.findByRole('button', { name: label }));
  await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
}

const rows = (text: string) => text.split('\n');

describe('AdminExports date window', () => {
  it('cuts sales reports to the chosen days', async () => {
    await renderLoaded();
    // End date one day past the last sale: see the timezone bug below.
    setRange('2026-01-05', '2026-01-21');

    await exportAs('Export sales item as CSV');

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('sales-by-item.csv');
    // Only o-in-1 and o-in-2: Tea 2 for $20, Mug 2 for $25.
    expect(rows(files[0].text)).toEqual([
      'Product,Quantity Sold,Total Revenue,Avg Price',
      'Mug,2,25,12.5',
      'Tea,2,20,10',
    ]);
    expect(toasts.at(-1)).toMatchObject({ title: 'Export completed successfully' });
  }, TIMEOUT);

  it('includes a sale from the evening of the end date, west of UTC', async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      api.orders.mockResolvedValue([order('o-evening', new Date(2026, 0, 20, 20).getTime(), 9, { items: [item('Jam', 1, 9)] })]);
      await renderLoaded();
      setRange('2026-01-20', '2026-01-20');

      await exportAs('Export sales item as CSV');

      expect(files[0]?.text ?? '').toContain('Jam');
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  }, TIMEOUT);

  it('fills in this month and clears back to everything', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'This Month' }));
    expect((screen.getByLabelText('Start Date') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.click(screen.getByRole('button', { name: 'This Year' }));
    expect((screen.getByLabelText('Start Date') as HTMLInputElement).value).toMatch(/-01-0[1-2]$|-12-31$/);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect((screen.getByLabelText('Start Date') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('End Date') as HTMLInputElement).value).toBe('');
  }, TIMEOUT);
});

describe('AdminExports sales reports', () => {
  it('month over month CSV has one row per month, newest first', async () => {
    await renderLoaded();

    await exportAs('Export sales mom as CSV');

    expect(rows(files[0].text)).toEqual([
      'Month,Total Revenue,Order Count,Items Sold,Avg Order Value',
      'February 2026,2000,1,1,2000',
      'January 2026,1045,3,5,348.3333333333333',
    ]);
  }, TIMEOUT);

  it('sales by customer quotes a name with a comma and files anonymous sales under walk-in', async () => {
    await renderLoaded();
    setRange('2026-01-05', '2026-01-21');

    await exportAs('Export sales customer as CSV');

    expect(rows(files[0].text)).toEqual([
      'Customer Name,Email,Total Revenue,Order Count,Avg Order Value',
      '"Lovelace, Ada",ada@shop.test,30,1,30',
      'Walk-in Customer,Walk-in,15,1,15',
    ]);
  }, TIMEOUT);

  it('week over week PDF lists the weeks in range', async () => {
    await renderLoaded();
    setRange('2026-01-05', '2026-01-21');

    await exportAs('Export sales wow as PDF');

    await waitFor(() => expect(pdfDocs).toHaveLength(1));
    expect(pdfDocs[0].texts).toContain('Sales Week-over-Week Report');
    expect(pdfDocs[0].tables[0].body.map((r) => r[0])).toEqual(['Week of Jan 18', 'Week of Jan 4']);
  }, TIMEOUT);

  it('trending CSV writes products and services as two files', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(at(2026, 0, 25));
    await renderLoaded();

    await exportAs('Export trending as CSV');

    expect(files.map((f) => f.name)).toEqual(['product-trends.csv', 'service-trends.csv']);
    expect(rows(files[1].text)).toEqual(['Service,Completions', 'Repair,1']);
  }, TIMEOUT);

  it.each([
    ['Export sales register as CSV', 'MAIN-01 — Front Counter'],
    ['Export sales cashier as CSV', 'Sam'],
  ])('%s asks the server for the range on screen and writes its rows', async (label, expected) => {
    await renderLoaded();
    setRange('2026-01-05', '2026-01-21');

    await exportAs(label);

    expect(files[0].text).toContain(expected);
    expect(files[0].name).toContain('2026-01-05-to-2026-01-21');
  }, TIMEOUT);

  it('reports a server failure during export instead of claiming success', async () => {
    api.salesByRegister.mockRejectedValue(new Error('report timed out'));
    await renderLoaded();

    await exportAs('Export sales register as CSV');

    expect(toasts.at(-1)).toMatchObject({ title: 'Export failed', description: 'report timed out' });
    expect(files).toEqual([]);
  }, TIMEOUT);
});

describe('AdminExports loss prevention', () => {
  it.each([
    ['Export drawer variance as CSV', '-5'],
    ['Export no sale counts as CSV', '7'],
  ])('%s writes the register figures', async (label, figure) => {
    await renderLoaded();
    openTab(/loss prevention/i);

    await exportAs(label);

    expect(rows(files[0].text)[1]).toContain(figure);
  }, TIMEOUT);
});

describe('AdminExports returns', () => {
  it('all-returns CSV is cut to the date window', async () => {
    await renderLoaded();
    openTab(/returns/i);
    setRange('2026-01-01', '2026-01-31');

    await exportAs('Export returns all as CSV');

    const lines = rows(files[0].text);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^RET-1,.*,ada@shop\.test,completed,Pending,processed,defective,10,0$/);
  }, TIMEOUT);

  it('all-returns PDF totals only completed refunds', async () => {
    await renderLoaded();
    openTab(/returns/i);

    await exportAs('Export returns all as PDF');

    await waitFor(() => expect(pdfDocs).toHaveLength(1));
    expect(pdfDocs[0].texts).toEqual(expect.arrayContaining(['Total Returns: 2', 'Completed: 1', 'Total Refunded: $10.00']));
  }, TIMEOUT);

  it('monthly CSV separates refunded from pending', async () => {
    await renderLoaded();
    openTab(/returns/i);

    await exportAs('Export returns monthly as CSV');

    expect(rows(files[0].text)).toEqual([
      'Month,Total Returns,Refunded Amount,Pending Amount',
      'February 2026,1,0,4',
      'January 2026,1,10,0',
    ]);
  }, TIMEOUT);

  it('by-reason PDF shows each reason\'s share', async () => {
    await renderLoaded();
    openTab(/returns/i);

    await exportAs('Export returns reason as PDF');

    await waitFor(() => expect(pdfDocs).toHaveLength(1));
    expect(pdfDocs[0].tables[0].body).toEqual([
      ['Defective Product', 1, '$10.00', '50.0%'],
      ['Other', 1, '$4.00', '50.0%'],
    ]);
  }, TIMEOUT);

  it('by-customer CSV counts returns per customer', async () => {
    await renderLoaded();
    openTab(/returns/i);

    await exportAs('Export returns customer as CSV');

    expect(rows(files[0].text)).toContain('"Lovelace, Ada",ada@shop.test,1,10');
  }, TIMEOUT);

  it('by-customer PDF names the customers and their refunds', async () => {
    await renderLoaded();
    openTab(/returns/i);

    await exportAs('Export returns customer as PDF');

    await waitFor(() => expect(pdfDocs).toHaveLength(1));
    expect(pdfDocs[0].tables[0].body.flat()).toContain('Lovelace, Ada');
  }, TIMEOUT);

  it('reports a failed PDF export instead of claiming success', async () => {
    await renderLoaded();
    openTab(/returns/i);
    vi.spyOn(pdfDocs, 'push').mockImplementation(() => {
      throw new Error('pdf boom');
    });

    await exportAs('Export returns customer as PDF');

    expect(toasts.map((t) => t.title)).toEqual(['Export failed']);
    vi.restoreAllMocks();
  }, TIMEOUT);
});

describe('AdminExports customers, services and inventory', () => {
  it('customer list CSV writes every customer', async () => {
    await renderLoaded();
    openTab(/customers/i);

    await exportAs('Export customer list as CSV');

    const lines = rows(files[0].text);
    expect(lines[0]).toBe('Name,Organization,Email,Phone,Address,City,State,ZIP,Country,Created');
    expect(lines[1]).toMatch(/^"Lovelace, Ada",,ada@shop\.test,,,London,/);
  }, TIMEOUT);

  it('asks for a customer before exporting one customer\'s history', async () => {
    await renderLoaded();
    openTab(/customers/i);

    await exportAs('Export customer history as CSV');

    expect(toasts.at(-1)).toMatchObject({ title: 'Please select a customer' });
    expect(files).toEqual([]);
  }, TIMEOUT);

  it('exports the chosen customer\'s sales and quotes, named after them', async () => {
    await renderLoaded();
    openTab(/customers/i);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: /grace hopper/i }));

    await exportAs('Export customer history as CSV');

    expect(files[0].name).toBe('customer-history-Grace-Hopper.csv');
    expect(rows(files[0].text)[1]).toMatch(/^Service Quote,q1,.*,0?1,50,completed,-$|^Service Quote,q1,.*,1,50,completed,-$/);
  }, TIMEOUT);

  it('all-customer history tags each transaction with its customer', async () => {
    await renderLoaded();
    openTab(/customers/i);

    await exportAs('Export customer history all as CSV');

    const lines = rows(files[0].text);
    expect(lines[0]).toBe('Type,ID,Date,Items,Total,Status,Payment,Customer');
    expect(lines.slice(1).map((l) => l.split(',')[1])).toEqual(['o-in-1', 'q1']);
  }, TIMEOUT);

  it.each([
    ['Export services type as CSV', 'Repair,Fix,,50,job,Yes'],
    ['Export services category as CSV', 'Fix,1,50,1'],
  ])('%s writes the service rows', async (label, expected) => {
    await renderLoaded();
    openTab(/services/i);

    await exportAs(label);

    expect(rows(files[0].text)[1]).toBe(expected);
  }, TIMEOUT);

  it('services PDF lists each service with its price', async () => {
    await renderLoaded();
    openTab(/services/i);

    await exportAs('Export services type as PDF');

    await waitFor(() => expect(pdfDocs).toHaveLength(1));
    expect(pdfDocs[0].tables[0].body).toEqual([['Repair', 'Fix', '$50.00', 'job', 'Yes']]);
  }, TIMEOUT);

  it('inventory CSV writes one row per variant', async () => {
    await renderLoaded();
    openTab(/inventory/i);

    await exportAs('Export inventory as CSV');

    expect(rows(files[0].text)[1]).toBe('p1,Shirt,Tops,20,v1,M,Red,0,,SH-M,,3,Yes');
  }, TIMEOUT);

  it('inventory Excel writes a real workbook and says so', async () => {
    await renderLoaded();
    openTab(/inventory/i);

    await exportAs('Export inventory as Excel');

    expect(files.map((f) => f.name)).toEqual(['inventory.xlsx']);
    expect(toasts.at(-1)).toMatchObject({ title: 'Export completed successfully' });
  }, TIMEOUT);
});

describe('AdminExports loading', () => {
  it('reports a store that will not load', async () => {
    api.orders.mockRejectedValue(new Error('orders offline'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AdminExports />
      </QueryClientProvider>
    );

    await waitFor(() => expect(toasts[0]).toMatchObject({ title: 'Error loading data', description: 'orders offline' }));
  }, TIMEOUT);
});
