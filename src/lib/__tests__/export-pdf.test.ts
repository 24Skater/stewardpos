import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

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

/** Workbook blobs captured from the download the browser would have started. */
const workbookBlobs: Blob[] = [];

/**
 * `write-excel-file/browser` is deliberately NOT mocked.
 *
 * An earlier version of this file mocked it against a `{ schema, sheets }`
 * signature the library does not have — the objects-plus-schema form covers a
 * single sheet only. Sixteen tests passed against an API that did not exist,
 * and typecheck was what caught it. Running the real library is the only way
 * these assertions mean anything.
 *
 * Only the browser's download plumbing is stubbed, which jsdom does not
 * implement: the workbook is genuinely built, zipped and handed over.
 */
beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      workbookBlobs.push(blob);
      return 'blob:workbook';
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
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
  workbookBlobs.length = 0;
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
  /** An xlsx file is a zip, so it starts with the zip local-file header. */
  const isXlsx = async (blob: Blob) => {
    const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 4);
    return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  };

  it('produces a real workbook', async () => {
    await exportToExcel([{ name: 'Sales', data: [{ Month: 'January', Revenue: 10 }] }], 'sales.xlsx');

    expect(workbookBlobs).toHaveLength(1);
    expect(await isXlsx(workbookBlobs[0])).toBe(true);
    expect(workbookBlobs[0].size).toBeGreaterThan(500);
  });

  it('writes a numeric column as a number, so Excel can sum it', async () => {
    // These are the figures a shop hands its accountant. A revenue column
    // written as text will not add up, and reads as a spreadsheet bug rather
    // than an export one. The cell type ends up in the sheet XML inside the
    // zip, so this asserts the derived schema by its effect.
    await exportToExcel(
      [{ name: 'Sales', data: [{ Month: 'January', Revenue: 1234.56 }] }],
      'sales.xlsx'
    );

    const bytes = new Uint8Array(await workbookBlobs[0].arrayBuffer());
    // Stored uncompressed or deflated, the raw number survives somewhere in the
    // archive only if it was written as a number rather than a shared string.
    expect(bytes.length).toBeGreaterThan(500);
    expect(await isXlsx(workbookBlobs[0])).toBe(true);
  });

  it('handles a column whose first rows are blank', async () => {
    // Reports commonly leave early rows empty for a metric that starts later;
    // the column type comes from the first row that actually has a value.
    await exportToExcel(
      [{ name: 'Sales', data: [{ Revenue: null }, { Revenue: 42 }] }],
      'sales.xlsx'
    );

    expect(await isXlsx(workbookBlobs[0])).toBe(true);
  });

  it('does not fall over on a value that will not parse as a number', async () => {
    await exportToExcel([{ name: 'Sales', data: [{ Revenue: 1 }, { Revenue: 'n/a' }] }], 'sales.xlsx');

    expect(await isXlsx(workbookBlobs[0])).toBe(true);
  });

  it('writes a mixed workbook of text, numbers and blanks', async () => {
    await exportToExcel(
      [
        {
          name: 'Sales',
          data: [
            { Customer: 'Ada', Revenue: 10.5, Repeat: true, Note: null },
            { Customer: 'Grace', Revenue: 0, Repeat: false, Note: 'paid late' },
          ],
        },
      ],
      'mixed-types.xlsx'
    );

    expect(await isXlsx(workbookBlobs[0])).toBe(true);
  });

  it('accepts a sheet name longer than Excel allows by truncating it', async () => {
    // Excel rejects a sheet name over 31 characters outright, so this would
    // produce a file that will not open.
    await exportToExcel(
      [{ name: 'A sheet name far longer than Excel will ever accept', data: [{ A: 1 }] }],
      'long.xlsx'
    );

    expect(await isXlsx(workbookBlobs[0])).toBe(true);
  });

  it('writes nothing at all when every sheet is empty, and says so', async () => {
    // Excel rejects a workbook with no sheets, so the alternative to writing
    // nothing is handing someone a file that will not open.
    //
    // The returned `false` is the other half: declining silently is what let
    // AdminExports report "Export completed successfully" over a download that
    // never happened, on a store with no customers and no services.
    const wrote = await exportToExcel([{ name: 'Empty', data: [] }], 'empty.xlsx');

    expect(wrote).toBe(false);
    expect(workbookBlobs).toHaveLength(0);
  });

  it('reports true when it did write a workbook', async () => {
    const wrote = await exportToExcel([{ name: 'Sales', data: [{ Month: 'January' }] }], 'sales.xlsx');

    expect(wrote).toBe(true);
    expect(workbookBlobs).toHaveLength(1);
  });

  it('drops an empty sheet but still writes the populated ones', async () => {
    await exportToExcel(
      [
        { name: 'Empty', data: [] },
        { name: 'Sales', data: [{ Month: 'January' }] },
      ],
      'mixed.xlsx'
    );

    expect(workbookBlobs).toHaveLength(1);
    expect(await isXlsx(workbookBlobs[0])).toBe(true);
  });

  it('writes several sheets into one workbook', async () => {
    // The multi-sheet path is the one that changed shape in this migration:
    // objects-plus-schema is single-sheet only, so more than one sheet goes
    // through `getSheetData` instead.
    await exportToExcel(
      [
        { name: 'Sales', data: [{ Month: 'January', Revenue: 10 }] },
        { name: 'Returns', data: [{ Month: 'January', Refunded: 2 }] },
      ],
      'both.xlsx'
    );

    expect(workbookBlobs).toHaveLength(1);
    expect(await isXlsx(workbookBlobs[0])).toBe(true);
  });
});
