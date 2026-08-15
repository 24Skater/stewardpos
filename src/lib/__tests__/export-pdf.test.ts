import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The PDF and spreadsheet exporters, actually executed.
 *
 * These had no coverage at all: `export-utils.test.ts` covers `exportToCSV` and
 * the pure report generators, and stops where the third-party libraries begin.
 * That was tolerable until jspdf moved from 3 to 4 for a critical path-traversal
 * advisory — a breaking major on code nothing exercised, where a typecheck pass
 * says only that the signatures still line up.
 *
 * So these assert on bytes. Every case renders a document and checks it really
 * is a PDF, because "did not throw" would pass just as happily on an empty file.
 */

/** Documents captured instead of being handed to the browser to download. */
const saved: Array<{ name: string; bytes: Uint8Array }> = [];

/** Workbook filenames, captured the same way. */
const workbooks: string[] = [];

/**
 * The real jsPDF, with only `save` intercepted.
 *
 * It cannot be a prototype spy or a subclass: as of jspdf 4 the document's
 * methods are assigned to the instance inside the constructor, so
 * `jsPDF.prototype.save` does not exist and a subclass override is shadowed by
 * the instance's own property. Wrapping the constructor and replacing the
 * method on the object it returns is what actually takes effect — and it leaves
 * every byte of the rendering path real.
 */
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

vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xlsx')>();
  return {
    ...actual,
    // Everything up to the write is real: the workbook is genuinely built from
    // the rows. Only the filesystem hand-off is stubbed.
    writeFile: (_book: unknown, filename: string) => {
      workbooks.push(filename);
    },
  };
});

const {
  exportCustomerListToPDF,
  exportOrdersToPDF,
  exportSalesMoMToPDF,
  exportToExcel,
  exportTrendingToPDF,
} = await import('../export-utils');

type ExportRow = import('../export-utils').ExportRow;
type Order = import('../export-utils').Order;
type OrderItem = import('../export-utils').OrderItem;

const SETTINGS = { storeName: 'Corner Store', storeEmail: 'hi@shop.test' };

const ORDER: Order = {
  id: 'order-0001-abcd',
  createdAt: Date.UTC(2026, 0, 15),
  subtotal: 100,
  discountTotal: 10,
  taxTotal: 9,
  total: 99,
  paymentMethod: 'Cash',
};

const ORDER_ITEM: OrderItem = {
  id: 'oi1',
  orderId: 'order-0001-abcd',
  productId: 'p1',
  nameSnapshot: 'Blue Shirt',
  quantity: 2,
  unitPrice: 12.5,
  lineTotal: 25,
};

/** The magic number every PDF starts with. */
const isPdf = (bytes: Uint8Array) =>
  new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';

beforeEach(() => {
  saved.length = 0;
  workbooks.length = 0;
});

describe('PDF exports', () => {
  it('renders a real PDF for the orders report', async () => {
    await exportOrdersToPDF([ORDER], [ORDER_ITEM], SETTINGS, {
      start: Date.UTC(2026, 0, 1),
      end: Date.UTC(2026, 0, 31),
    });

    expect(saved).toHaveLength(1);
    expect(isPdf(saved[0].bytes)).toBe(true);
    expect(saved[0].bytes.byteLength).toBeGreaterThan(1000);
  });

  it('names the file after the report and the day', async () => {
    await exportOrdersToPDF([ORDER], [ORDER_ITEM], SETTINGS, { start: 0, end: 1 });

    expect(saved[0].name).toMatch(/^orders-report-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('renders a report built from generated rows', async () => {
    const rows: ExportRow[] = [
      { Month: 'January 2026', 'Total Revenue': 990, 'Order Count': 10, 'Items Sold': 20, 'Avg Order Value': 99 },
    ];

    await exportSalesMoMToPDF(rows, SETTINGS);

    expect(isPdf(saved[0].bytes)).toBe(true);
  });

  it('renders landscape without complaint', async () => {
    // The only exporter that passes an orientation to the constructor.
    await exportCustomerListToPDF(
      [{ Name: 'Ada', Organization: 'Analytical', Email: 'ada@shop.test', Phone: '', City: 'London', State: '' }],
      SETTINGS
    );

    expect(isPdf(saved[0].bytes)).toBe(true);
  });

  it('stacks a second table under the first', async () => {
    // The tightest coupling between jspdf and jspdf-autotable: this reads
    // `doc.lastAutoTable.finalY` — a property the plugin bolts onto the document
    // — to place the second table. If the two ever stop agreeing about that,
    // this is where it shows, and it is the reason the plugin had to be
    // upgraded in lockstep rather than left on the version that peers `^2 || ^3`.
    await exportTrendingToPDF(
      [{ Product: 'Tea', 'Recent Sales': 10, 'Previous Period': 4, 'Change %': 150, Trend: 'Growing' }],
      [{ Service: 'Repair', Completions: 3 }],
      SETTINGS
    );

    expect(isPdf(saved[0].bytes)).toBe(true);
  });

  it('renders with no rows at all rather than throwing', async () => {
    // A shop with nothing to report still presses the button.
    await exportSalesMoMToPDF([], SETTINGS);

    expect(isPdf(saved[0].bytes)).toBe(true);
  });

  it('renders without store settings', async () => {
    await exportSalesMoMToPDF([{ Month: 'January 2026', 'Total Revenue': 1 }]);

    expect(isPdf(saved[0].bytes)).toBe(true);
  });
});

describe('exportToExcel', () => {
  it('writes a workbook under the requested name', async () => {
    await exportToExcel([{ name: 'Sales', data: [{ Month: 'January', Revenue: 10 }] }], 'sales.xlsx');

    expect(workbooks).toEqual(['sales.xlsx']);
  });

  it('still writes when a sheet is empty rather than throwing', async () => {
    // A shop with nothing in one section still presses Export.
    await exportToExcel([{ name: 'Empty', data: [] }], 'empty.xlsx');

    expect(workbooks).toEqual(['empty.xlsx']);
  });

  it('truncates a sheet name to the 31 characters Excel allows', async () => {
    await exportToExcel(
      [{ name: 'A sheet name far longer than Excel will accept', data: [{ A: 1 }] }],
      'long.xlsx'
    );

    expect(workbooks).toEqual(['long.xlsx']);
  });
});
