import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

/**
 * The sales summary export, in all three formats.
 *
 * The task's acceptance criterion is that an exported report reconciles with the
 * report on screen. That is asserted here structurally — every figure in every
 * format is traced back to the single payload the screen was rendered from —
 * and then the PDF and workbook are genuinely rendered, so "reconciles" cannot
 * be satisfied by a file that never gets written.
 *
 * The jsPDF interception mirrors `export-pdf.test.ts`: as of jspdf 4 the
 * document's methods are assigned to the instance in the constructor, so
 * `save` has to be replaced on the returned object rather than on a prototype.
 */
const saved: Array<{ name: string; bytes: Uint8Array }> = [];

vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>();
  const Real = actual.default;

  function Capturing(this: unknown, ...args: unknown[]) {
    const doc = new (Real as unknown as new (...a: unknown[]) => Record<string, unknown>)(...args);

    doc.save = (name?: string) => {
      const output = doc.output as (kind: string) => ArrayBuffer;
      saved.push({ name: String(name), bytes: new Uint8Array(output.call(doc, 'arraybuffer')) });
      return doc;
    };

    return doc;
  }

  return { ...actual, default: Capturing };
});

/** What the browser would have downloaded. */
const downloads: { name: string; blob: Blob }[] = [];
let lastDownloadName = '';

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      downloads.push({ name: lastDownloadName, blob });
      return 'blob:export';
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    lastDownloadName = this.download;
    // The anchor's href was assigned before click, so the blob is already
    // captured; this only records which file it was.
    if (downloads.length > 0) downloads[downloads.length - 1].name = this.download;
  });
});

const {
  describeExportRange,
  exportSalesSummaryToCSV,
  exportSalesSummaryToExcel,
  exportSalesSummaryToPDF,
  generateSalesSummaryReport,
  salesSummarySheets,
} = await import('../export-sales-summary');

type SalesSummaryExport = import('../export-sales-summary').SalesSummaryExport;

/**
 * One period's figures, exactly as `/api/reports/*` returns them.
 *
 * Internally consistent on purpose — gross less discounts plus tax is the net,
 * the daily rows sum to it, and the tender split sums to it — because the point
 * of the export is that it does not disturb any of that.
 */
const PAYLOAD: SalesSummaryExport = {
  summary: {
    from: Date.parse('2026-08-01T00:00:00.000Z'),
    to: Date.parse('2026-08-02T23:59:59.999Z'),
    orderCount: 3,
    gross: 40,
    discounts: 2,
    tax: 2.24,
    net: 40.24,
    refunds: 5.44,
    netAfterRefunds: 34.8,
    avgTicket: 13.41,
    pendingRefunds: 10,
  },
  byDay: [
    { date: '2026-08-01', orderCount: 2, gross: 30, net: 29.44 },
    { date: '2026-08-02', orderCount: 1, gross: 10, net: 10.8 },
  ],
  topProducts: [
    { productId: 'p-tea', name: 'Loose Leaf Tea', quantity: 6, revenue: 30 },
    { productId: 'p-mug', name: 'Mug', quantity: 1, revenue: 10 },
  ],
  paymentMix: [
    { method: 'cash', count: 2, amount: 23.44 },
    { method: 'card', count: 2, amount: 16.8 },
  ],
  returns: {
    byReason: [{ reasonCode: 'defective', returnCount: 1, refunded: 5.44 }],
  },
};

const SETTINGS = { storeName: 'Corner Store', storeEmail: 'hi@shop.test' };

const isPdf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';

/** Read a labelled figure out of the totals sheet. */
function measure(rows: ReturnType<typeof generateSalesSummaryReport>['totals'], label: string) {
  return rows.find((row) => row.Measure === label)?.Value;
}

beforeEach(() => {
  saved.length = 0;
  downloads.length = 0;
});

describe('generateSalesSummaryReport', () => {
  it('carries every figure through unchanged', () => {
    const report = generateSalesSummaryReport(PAYLOAD);

    // Not recomputed, not rounded again: the server already decided these.
    expect(measure(report.totals, 'Gross sales')).toBe(PAYLOAD.summary.gross);
    expect(measure(report.totals, 'Discounts')).toBe(PAYLOAD.summary.discounts);
    expect(measure(report.totals, 'Tax collected')).toBe(PAYLOAD.summary.tax);
    expect(measure(report.totals, 'Net sales')).toBe(PAYLOAD.summary.net);
    expect(measure(report.totals, 'Refunds (completed)')).toBe(PAYLOAD.summary.refunds);
    expect(measure(report.totals, 'Kept after refunds')).toBe(PAYLOAD.summary.netAfterRefunds);
    expect(measure(report.totals, 'Average ticket')).toBe(PAYLOAD.summary.avgTicket);
    expect(measure(report.totals, 'Orders')).toBe(PAYLOAD.summary.orderCount);
  });

  it('states the period it covers', () => {
    // A page of figures with no period on it is not a report someone can file.
    expect(measure(generateSalesSummaryReport(PAYLOAD).totals, 'Period')).toBe(
      '2026-08-01 to 2026-08-02'
    );
  });

  it('names a single day once', () => {
    const oneDay = Date.parse('2026-08-01T00:00:00.000Z');
    expect(
      describeExportRange({ ...PAYLOAD.summary, from: oneDay, to: oneDay + 86_399_999 })
    ).toBe('2026-08-01');
  });

  it('keeps the daily rows summing to the net on the summary sheet', () => {
    const report = generateSalesSummaryReport(PAYLOAD);

    const summed = report.byDay.reduce((cents, row) => cents + Math.round(Number(row.Net) * 100), 0);
    expect(summed).toBe(Math.round(Number(measure(report.totals, 'Net sales')) * 100));
  });

  it('keeps the tender split summing to the net', () => {
    const report = generateSalesSummaryReport(PAYLOAD);

    const tendered = report.paymentMix.reduce(
      (cents, row) => cents + Math.round(Number(row.Amount) * 100),
      0
    );
    expect(tendered).toBe(Math.round(Number(measure(report.totals, 'Net sales')) * 100));
  });

  it('writes amounts as numbers, so a spreadsheet can sum them', () => {
    const report = generateSalesSummaryReport(PAYLOAD);

    expect(typeof report.byDay[0].Net).toBe('number');
    expect(typeof report.topProducts[0].Revenue).toBe('number');
  });

  it('reports an empty period without inventing rows', () => {
    const empty: SalesSummaryExport = {
      summary: { ...PAYLOAD.summary, orderCount: 0, gross: 0, discounts: 0, tax: 0, net: 0, refunds: 0, netAfterRefunds: 0, avgTicket: 0, pendingRefunds: 0 },
      byDay: [],
      topProducts: [],
      paymentMix: [],
      returns: { byReason: [] },
    };

    const report = generateSalesSummaryReport(empty);

    expect(report.byDay).toEqual([]);
    expect(measure(report.totals, 'Net sales')).toBe(0);
  });
});

describe('salesSummarySheets', () => {
  it('lays the report out one section per sheet', () => {
    expect(salesSummarySheets(PAYLOAD).map((sheet) => sheet.name)).toEqual([
      'Summary',
      'By Day',
      'Top Products',
      'Payment Mix',
      'Returns by Reason',
    ]);
  });
});

describe('exporting', () => {
  it('writes a CSV of the totals, named for the period', () => {
    exportSalesSummaryToCSV(PAYLOAD);

    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('sales-summary-2026-08-01-to-2026-08-02.csv');
  });

  it('puts the same figures in the CSV as in the report', async () => {
    exportSalesSummaryToCSV(PAYLOAD);
    const text = await downloads[0].blob.text();

    expect(text).toContain('Net sales,40.24');
    expect(text).toContain('Gross sales,40');
    expect(text).toContain('Refunds (completed),5.44');
  });

  it('renders a real PDF', async () => {
    await exportSalesSummaryToPDF(PAYLOAD, SETTINGS);

    expect(saved).toHaveLength(1);
    expect(isPdf(saved[0].bytes)).toBe(true);
    expect(saved[0].name).toBe('sales-summary-2026-08-01-to-2026-08-02.pdf');
    // Substantial enough to be the multi-section document, not a blank page.
    expect(saved[0].bytes.byteLength).toBeGreaterThan(2000);
  });

  it('renders a PDF for an empty period rather than throwing', async () => {
    // Every optional section is skipped; without the guard the second
    // `autoTable` would read `lastAutoTable` off a document that has none.
    await exportSalesSummaryToPDF({
      summary: PAYLOAD.summary,
      byDay: [],
      topProducts: [],
      paymentMix: [],
      returns: { byReason: [] },
    });

    expect(isPdf(saved[0].bytes)).toBe(true);
  });

  it('writes a real workbook', async () => {
    await exportSalesSummaryToExcel(PAYLOAD);

    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('sales-summary-2026-08-01-to-2026-08-02.xlsx');
    // xlsx files are zips: `PK` is the archive's magic number.
    const bytes = new Uint8Array(await downloads[0].blob.arrayBuffer());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');
  });
});
