import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pdfDocs, FAKE_TABLE_HEIGHT } from '@/test/fake-pdf-kit';

/**
 * The report builders and what their PDFs say.
 *
 * `export-utils.test.ts` covers the CSV writer and the first few generators;
 * `export-pdf.test.ts` proves the real jspdf produces a valid file. This file is
 * the arithmetic in between — month and week buckets, trend windows, refund
 * totals — and the words and figures each PDF puts on the page. jspdf is
 * replaced by a recorder so the assertions are on content, not on bytes.
 */

vi.mock('jspdf', () => import('@/test/fake-pdf-kit').then((m) => m.jspdfModule));
vi.mock('jspdf-autotable', () => import('@/test/fake-pdf-kit').then((m) => m.autoTableModule));

const {
  generateSalesMoMReport,
  generateSalesWoWReport,
  generateTrendingReport,
  generateCustomerOrderHistoryReport,
  generateServicesByTypeReport,
  generateServicesByCategoryReport,
  generateReturnsReport,
  generateReturnsByCustomerReport,
  generateReturnsMonthlyReport,
  generateReturnsByReasonReport,
  exportInventoryToCSV,
  exportOrdersToPDF,
  exportSalesMoMToPDF,
  exportSalesWoWToPDF,
  exportSalesByCustomerToPDF,
  exportSalesByItemToPDF,
  exportTrendingToPDF,
  exportCustomerListToPDF,
  exportServicesToPDF,
  exportReturnsToPDF,
  exportReturnsByReasonToPDF,
} = await import('../export-utils');

type Order = import('../export-utils').Order;

const DAY = 86_400_000;
/** Local-time timestamps, so month and week buckets do not depend on the runner's zone. */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

const order = (overrides: Partial<Order>): Order => ({
  id: 'order-xxxxxxxx',
  createdAt: at(2026, 0, 15),
  subtotal: 0,
  discountTotal: 0,
  taxTotal: 0,
  total: 0,
  paymentMethod: 'cash',
  ...overrides,
});

const item = (name: string, quantity: number, lineTotal: number) => ({
  id: `${name}-${quantity}`,
  orderId: 'o',
  productId: name,
  nameSnapshot: name,
  quantity,
  unitPrice: lineTotal / quantity,
  lineTotal,
});

const ret = (overrides: Record<string, unknown>) =>
  ({
    id: 'r',
    returnNumber: 'RET-1',
    returnType: 'return',
    status: 'completed',
    total: 0,
    refundStatus: 'processed',
    createdAt: at(2026, 0, 15),
    ...overrides,
  }) as never;

const SETTINGS = { storeName: 'Corner Store', storeEmail: 'hi@shop.test', storePhone: '555-0100' };

beforeEach(() => {
  pdfDocs.length = 0;
});

describe('generateSalesMoMReport', () => {
  const orders = [
    order({ createdAt: at(2026, 0, 3), total: 100, items: [item('Tea', 2, 100)] }),
    order({ createdAt: at(2026, 0, 28), total: 50, items: [item('Tea', 1, 50), item('Mug', 3, 0)] }),
    order({ createdAt: at(2026, 1, 2), total: 30 }),
  ];

  it('buckets orders by calendar month and sums revenue, count and units', () => {
    const report = generateSalesMoMReport(orders);
    const january = report.find((r) => r.Month === 'January 2026')!;

    expect(january['Total Revenue']).toBe(150);
    expect(january['Order Count']).toBe(2);
    expect(january['Items Sold']).toBe(6);
    expect(january['Avg Order Value']).toBe(75);
  });

  it('counts an order with no item list as zero units, not NaN', () => {
    const february = generateSalesMoMReport(orders).find((r) => r.Month === 'February 2026')!;

    expect(february['Items Sold']).toBe(0);
  });

  it('lists the most recent month first', () => {
    expect(generateSalesMoMReport(orders).map((r) => r.Month)).toEqual(['February 2026', 'January 2026']);
  });
});

describe('generateSalesWoWReport', () => {
  it('groups by the Sunday that starts the week', () => {
    // Sun 4 Jan and Sat 10 Jan 2026 are one week; Sun 11 Jan starts the next.
    const report = generateSalesWoWReport([
      order({ createdAt: at(2026, 0, 4), total: 10 }),
      order({ createdAt: at(2026, 0, 10), total: 20, items: [item('Tea', 4, 20)] }),
      order({ createdAt: at(2026, 0, 11), total: 5 }),
    ]);

    expect(report).toEqual([
      { Week: 'Week of Jan 11', 'Total Revenue': 5, 'Order Count': 1, 'Items Sold': 0, 'Avg Order Value': 5 },
      { Week: 'Week of Jan 4', 'Total Revenue': 30, 'Order Count': 2, 'Items Sold': 4, 'Avg Order Value': 15 },
    ]);
  });

  it('keeps the same calendar week in different years apart', () => {
    const report = generateSalesWoWReport([
      order({ createdAt: at(2025, 0, 5), total: 100 }), // a Sunday
      order({ createdAt: at(2020, 0, 5), total: 7 }), // also a Sunday
    ]);

    expect(report).toHaveLength(2);
  });
});

describe('generateTrendingReport', () => {
  const NOW = at(2026, 5, 30);

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const recent = NOW - 5 * DAY;
  const previous = NOW - 40 * DAY;
  const ancient = NOW - 90 * DAY;

  it('compares the last window to the one before it', () => {
    const { productTrends } = generateTrendingReport(
      [
        order({ createdAt: recent, items: [item('Tea', 15, 15), item('Mug', 5, 5), item('Jam', 10, 10)] }),
        order({ createdAt: previous, items: [item('Tea', 10, 10), item('Mug', 10, 10), item('Jam', 10, 10)] }),
      ],
      []
    );

    expect(productTrends.map((t) => [t.Product, t['Change %'], t.Trend])).toEqual([
      ['Tea', 50, '📈 Growing'],
      ['Jam', 0, '➡️ Stable'],
      ['Mug', -50, '📉 Declining'],
    ]);
  });

  it('calls a product with no previous sales +100%, not infinite', () => {
    const { productTrends } = generateTrendingReport([order({ createdAt: recent, items: [item('New', 3, 3)] })], []);

    expect(productTrends[0]).toMatchObject({ 'Previous Period': 0, 'Change %': 100 });
  });

  it('ignores sales older than two windows back', () => {
    const { productTrends } = generateTrendingReport(
      [order({ createdAt: recent, items: [item('Tea', 1, 1)] }), order({ createdAt: ancient, items: [item('Tea', 50, 50)] })],
      []
    );

    expect(productTrends[0]['Previous Period']).toBe(0);
  });

  it('honours a custom window length', () => {
    // With a 3-day window, 5 days ago is the previous period, not the recent one.
    const { productTrends } = generateTrendingReport([order({ createdAt: recent, items: [item('Tea', 1, 1)] })], [], 3);

    expect(productTrends).toEqual([]);
  });

  it('caps products at twenty', () => {
    const items = Array.from({ length: 25 }, (_, i) => item(`P${i}`, 1, 1));
    const { productTrends } = generateTrendingReport([order({ createdAt: recent, items })], []);

    expect(productTrends).toHaveLength(20);
  });

  it('counts only recent, completed quotes as service completions, top ten by count', () => {
    const quote = (status: string, createdAt: number, items: { description: string; quantity: number }[]) =>
      ({ id: 'q', status, createdAt, subtotal: 0, taxTotal: 0, total: 0, items }) as never;
    const many = Array.from({ length: 12 }, (_, i) => ({ description: `S${i}`, quantity: 1 }));

    const { serviceTrends } = generateTrendingReport(
      [],
      [
        quote('completed', recent, [{ description: 'Repair', quantity: 4 }, ...many]),
        quote('completed', recent, [{ description: 'Repair', quantity: 1 }]),
        quote('draft', recent, [{ description: 'Repair', quantity: 100 }]),
        quote('completed', previous, [{ description: 'Repair', quantity: 100 }]),
      ]
    );

    expect(serviceTrends).toHaveLength(10);
    expect(serviceTrends[0]).toEqual({ Service: 'Repair', Completions: 5 });
  });
});

describe('generateCustomerOrderHistoryReport', () => {
  const customer = { id: 'c1', name: 'Ada', email: 'ada@shop.test', createdAt: 0 } as never;

  it('totals POS sales and only completed service quotes', () => {
    const { customer: info } = generateCustomerOrderHistoryReport(
      customer,
      [order({ total: 20 }), order({ total: 5 })],
      [
        { id: 'q1', status: 'completed', total: 100, createdAt: 0 },
        { id: 'q2', status: 'draft', total: 999, createdAt: 0 },
      ] as never[]
    );

    expect(info).toEqual({
      Name: 'Ada',
      Email: 'ada@shop.test',
      Phone: '',
      'Total POS Sales': 25,
      'Total Service Revenue': 100,
    });
  });

  it('interleaves sales and quotes, newest first', () => {
    const { transactions } = generateCustomerOrderHistoryReport(
      customer,
      [order({ id: 'old-sale', createdAt: at(2026, 0, 1), items: [item('Tea', 1, 1)] })],
      [{ id: 'new-quote', status: 'sent', total: 1, createdAt: at(2026, 2, 1) }] as never[]
    );

    expect(transactions.map((t) => [t.ID, t.Type, t.Items, t.Payment])).toEqual([
      ['new-quote', 'Service Quote', 0, '-'],
      ['old-sale', 'POS Sale', 1, 'cash'],
    ]);
  });
});

describe('service reports', () => {
  const services = [
    { id: 's1', name: 'Repair', category: 'Fix', basePrice: 40, unitType: 'hour', isActive: true },
    { id: 's2', name: 'Tune', category: 'Fix', isActive: false },
    { id: 's3', name: 'Paint', category: 'Art', isActive: true },
  ] as never[];

  it('lists each service with blanks rather than undefined', () => {
    expect(generateServicesByTypeReport(services)[1]).toEqual({
      Name: 'Tune',
      Category: 'Fix',
      Description: '',
      'Base Price': 0,
      'Unit Type': '',
      Active: 'No',
    });
  });

  it('adds completed-quote revenue to the service category, ignoring unknown services', () => {
    const quotes = [
      { status: 'completed', items: [{ serviceId: 's3', lineTotal: 300 }, { serviceId: 'gone', lineTotal: 5 }] },
      { status: 'completed', items: [{ serviceId: 's1', lineTotal: 80 }, { serviceId: 's2', lineTotal: 20 }] },
      { status: 'draft', items: [{ serviceId: 's1', lineTotal: 1000 }] },
    ] as never[];

    expect(generateServicesByCategoryReport(services, quotes)).toEqual([
      { Category: 'Art', 'Service Count': 1, 'Total Revenue': 300, Completions: 1 },
      { Category: 'Fix', 'Service Count': 2, 'Total Revenue': 100, Completions: 2 },
    ]);
  });
});

describe('returns reports', () => {
  it('fills in sensible words for missing customer, refund method and reason', () => {
    const [row] = generateReturnsReport([ret({ total: 12.5, refundStatus: 'pending' })]);

    expect(row).toMatchObject({
      'Return #': 'RET-1',
      Customer: 'Guest',
      'Refund Method': 'Pending',
      Reason: 'Not specified',
      Total: 12.5,
      Items: 0,
    });
  });

  it('prefers the customer name to the email', () => {
    const [row] = generateReturnsReport([ret({ customerName: 'Ada', customerEmail: 'a@x', items: [{}, {}] })]);

    expect(row.Customer).toBe('Ada');
    expect(row.Items).toBe(2);
  });

  it('counts every return per customer but only refunds completed ones', () => {
    const report = generateReturnsByCustomerReport(
      [
        ret({ customerEmail: 'ada@x', total: 10 }),
        ret({ customerEmail: 'ada@x', total: 99, status: 'pending' }),
        ret({ customerEmail: 'bob@x', customerName: 'Bob from receipt', total: 4 }),
        ret({ total: 1 }),
      ],
      [{ id: 'c', name: 'Ada Lovelace', email: 'ada@x', createdAt: 0 }] as never[]
    );

    expect(report[0]).toEqual({ 'Customer Name': 'Ada Lovelace', Email: 'ada@x', 'Total Returns': 2, 'Total Refunded': 10 });
    expect(report.find((r) => r.Email === 'bob@x')!['Customer Name']).toBe('Bob from receipt');
    expect(report.find((r) => r.Email === 'Walk-in')!['Customer Name']).toBe('Walk-in');
  });

  it('splits each month into refunded and still-pending money', () => {
    const report = generateReturnsMonthlyReport([
      ret({ total: 10, status: 'completed' }),
      ret({ total: 3, status: 'pending' }),
      ret({ total: 50, status: 'rejected' }),
      ret({ total: 7, status: 'completed', createdAt: at(2026, 2, 1) }),
    ]);

    expect(report).toEqual([
      { Month: 'March 2026', 'Total Returns': 1, 'Refunded Amount': 7, 'Pending Amount': 0 },
      { Month: 'January 2026', 'Total Returns': 3, 'Refunded Amount': 10, 'Pending Amount': 3 },
    ]);
  });

  it('labels reasons, files a missing one under Other, and gives each a share of the count', () => {
    const report = generateReturnsByReasonReport([
      ret({ reasonCode: 'defective', total: 10 }),
      ret({ reasonCode: 'defective', total: 5 }),
      ret({ total: 2 }),
      ret({ reasonCode: 'lost_in_post', total: 1 }),
    ]);

    expect(report).toEqual([
      { Reason: 'Defective Product', 'Return Count': 2, 'Total Value': 15, Percentage: 50 },
      { Reason: 'Other', 'Return Count': 1, 'Total Value': 2, Percentage: 25 },
      { Reason: 'lost_in_post', 'Return Count': 1, 'Total Value': 1, Percentage: 25 },
    ]);
  });
});

describe('exportInventoryToCSV', () => {
  let written = '';

  beforeEach(() => {
    written = '';
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

  it('writes one row per variant with the product carried onto each', () => {
    const wrote = exportInventoryToCSV([
      {
        id: 'p1',
        name: 'Shirt, Blue',
        category: 'Tops',
        basePrice: 20,
        variants: [
          { id: 'v1', size: 'M', color: 'Blue', priceDelta: 2, priceOverride: 25, sku: 'S-M', barcode: '123', stock: 4, enabled: true },
          { id: 'v2', stock: 0, enabled: false },
        ],
      },
    ] as never[]);

    const lines = written.split('\n');
    expect(wrote).toBe(true);
    expect(lines[0]).toBe(
      'Product ID,Product Name,Category,Base Price,Variant ID,Size,Color,Price Delta,Price Override,SKU,Barcode,Stock,Enabled'
    );
    expect(lines[1]).toBe('p1,"Shirt, Blue",Tops,20,v1,M,Blue,2,25,S-M,123,4,Yes');
    expect(lines[2]).toBe('p1,"Shirt, Blue",Tops,20,v2,N/A,N/A,0,,,,0,No');
  });

  it('reports false for a shop with no variants', () => {
    expect(exportInventoryToCSV([])).toBe(false);
  });
});

describe('PDF content', () => {
  const today = new Date().toISOString().split('T')[0];

  it('orders report states the store, range, totals and one row per order', async () => {
    await exportOrdersToPDF(
      [
        order({ id: 'abcdefgh-1', subtotal: 10, taxTotal: 0.8, total: 10.8, paymentMethod: 'card' }),
        order({ id: 'zzzzzzzz-2', subtotal: 20, taxTotal: 1.6, total: 21.6 }),
      ],
      [],
      SETTINGS,
      { start: at(2026, 0, 1), end: at(2026, 0, 31) }
    );

    const [doc] = pdfDocs;
    expect(doc.texts).toEqual(
      expect.arrayContaining([
        'Corner Store',
        'hi@shop.test',
        '555-0100',
        'Orders Report',
        `${new Date(at(2026, 0, 1)).toLocaleDateString()} - ${new Date(at(2026, 0, 31)).toLocaleDateString()}`,
        'Total Orders: 2',
        'Total Revenue: $32.40',
        'Average Ticket: $16.20',
      ])
    );
    expect(doc.tables[0].head).toEqual([['Order ID', 'Date', 'Subtotal', 'Tax', 'Total', 'Payment']]);
    expect(doc.tables[0].body[0]).toEqual(['abcdefgh...', expect.any(String), '$10.00', '$0.80', '$10.80', 'card']);
    expect(doc.savedAs).toBe(`orders-report-${today}.pdf`);
  });

  it('orders report shows a zero average for an empty range rather than NaN', async () => {
    await exportOrdersToPDF([], [], {}, { start: 0, end: 0 });

    expect(pdfDocs[0].texts).toContain('Average Ticket: $0.00');
    expect(pdfDocs[0].texts).toContain('Steward · Register');
  });

  it('month-over-month sums revenue and orders across rows, coercing string cells', async () => {
    await exportSalesMoMToPDF([
      { Month: 'February 2026', 'Total Revenue': 10.5, 'Order Count': 2, 'Items Sold': 3, 'Avg Order Value': 5.25 },
      { Month: 'January 2026', 'Total Revenue': '4.5', 'Order Count': '1', 'Items Sold': 1, 'Avg Order Value': 'n/a' },
    ]);

    const [doc] = pdfDocs;
    expect(doc.texts).toContain('Total Revenue: $15.00');
    expect(doc.texts).toContain('Total Orders: 3');
    expect(doc.tables[0].body).toEqual([
      ['February 2026', '$10.50', 2, 3, '$5.25'],
      ['January 2026', '$4.50', '1', 1, '$0.00'],
    ]);
    expect(doc.savedAs).toBe(`sales-mom-${today}.pdf`);
  });

  it('week-over-week renders each week row', async () => {
    await exportSalesWoWToPDF([{ Week: 'Week of Jan 4', 'Total Revenue': 30, 'Order Count': 2, 'Items Sold': 4, 'Avg Order Value': 15 }]);

    expect(pdfDocs[0].tables[0].head).toEqual([['Week', 'Revenue', 'Orders', 'Items', 'Avg Order']]);
    expect(pdfDocs[0].tables[0].body).toEqual([['Week of Jan 4', '$30.00', 2, 4, '$15.00']]);
    expect(pdfDocs[0].savedAs).toBe(`sales-wow-${today}.pdf`);
  });

  it('sales by customer truncates long names and stops at fifty rows', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      'Customer Name': 'A very long customer name indeed',
      Email: `customer-number-${i}@a-long-domain.example`,
      'Total Revenue': i,
      'Order Count': 1,
      'Avg Order Value': i,
    }));

    await exportSalesByCustomerToPDF(rows);

    const { body } = pdfDocs[0].tables[0];
    expect(body).toHaveLength(50);
    expect(body[0]).toEqual(['A very long customer', 'customer-number-0@a-long-', '$0.00', 1, '$0.00']);
  });

  it('sales by item truncates product names to thirty characters', async () => {
    await exportSalesByItemToPDF([
      { Product: 'x'.repeat(40), 'Quantity Sold': 3, 'Total Revenue': 9, 'Avg Price': 3 },
    ]);

    expect(pdfDocs[0].tables[0].body).toEqual([['x'.repeat(30), 3, '$9.00', '$3.00']]);
  });

  it('trending puts the services table below the products table', async () => {
    await exportTrendingToPDF(
      [{ Product: 'Tea', 'Recent Sales': 10, 'Previous Period': 4, 'Change %': 150, Trend: 'Growing' }],
      [{ Service: 'Repair', Completions: 3 }],
      SETTINGS
    );

    const [doc] = pdfDocs;
    const [products, services] = doc.tables;
    expect(doc.texts).toEqual(expect.arrayContaining(['Product Trends', 'Top Services']));
    expect(products.body).toEqual([['Tea', 10, 4, '150.0%', 'Growing']]);
    expect(services.body).toEqual([['Repair', 3]]);
    // 15pt gap after the first table's end, plus 6 for the heading.
    expect(services.startY).toBe((products.startY ?? 0) + FAKE_TABLE_HEIGHT + 15 + 6);
  });

  it('customer list is landscape and states the head count', async () => {
    await exportCustomerListToPDF([
      { Name: 'Ada', Organization: 'Analytical', Email: 'a@x', Phone: '1', City: 'London', State: '' },
    ]);

    const [doc] = pdfDocs;
    expect(doc.orientation).toBe('landscape');
    expect(doc.texts.some((t) => t.startsWith('Total: 1 customers'))).toBe(true);
    expect(doc.tables[0].body).toEqual([['Ada', 'Analytical', 'a@x', '1', 'London', '']]);
  });

  it('services report formats the base price as money', async () => {
    await exportServicesToPDF([{ Name: 'Repair', Category: 'Fix', 'Base Price': 40, 'Unit Type': 'hour', Active: 'Yes' }]);

    expect(pdfDocs[0].tables[0].body).toEqual([['Repair', 'Fix', '$40.00', 'hour', 'Yes']]);
    expect(pdfDocs[0].savedAs).toBe(`services-${today}.pdf`);
  });

  it('returns report counts all returns but totals only completed refunds', async () => {
    await exportReturnsToPDF([
      ret({ total: 10, status: 'completed', customerEmail: 'someone-with-a-long-address@example.com' }),
      ret({ total: 99, status: 'pending', customerName: 'Ada' }),
      ret({ total: 5, status: 'completed' }),
    ]);

    const [doc] = pdfDocs;
    expect(doc.texts).toEqual(expect.arrayContaining(['Total Returns: 3', 'Completed: 2', 'Total Refunded: $15.00']));
    expect(doc.tables[0].body.map((row) => [row[2], row[5]])).toEqual([
      ['someone-with-a-long-', '$10.00'],
      ['Ada', '$99.00'],
      ['Guest', '$5.00'],
    ]);
  });

  it('returns by reason formats value as money and share as a percentage', async () => {
    await exportReturnsByReasonToPDF([{ Reason: 'Damaged', 'Return Count': 1, 'Total Value': 2.5, Percentage: 33.333 }]);

    expect(pdfDocs[0].tables[0].body).toEqual([['Damaged', 1, '$2.50', '33.3%']]);
    expect(pdfDocs[0].savedAs).toBe(`returns-by-reason-${today}.pdf`);
  });
});
