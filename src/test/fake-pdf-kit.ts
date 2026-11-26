/**
 * A stand-in for jspdf + jspdf-autotable that records what a report put on the
 * page instead of rasterising it.
 *
 * The real libraries are exercised byte-for-byte in `export-pdf.test.ts`. This
 * fake exists for the other question — *what* the document says: the title,
 * the totals line, the table header and every cell. Wire it up with
 *
 *   vi.mock('jspdf', () => import('@/test/fake-pdf-kit').then((m) => m.jspdfModule));
 *   vi.mock('jspdf-autotable', () => import('@/test/fake-pdf-kit').then((m) => m.autoTableModule));
 */

export interface FakeTable {
  startY?: number;
  head: unknown[][];
  body: unknown[][];
}

export interface FakePdf {
  orientation?: string;
  texts: string[];
  tables: FakeTable[];
  savedAs?: string;
}

/** Every document constructed since the last `pdfDocs.length = 0`. */
export const pdfDocs: FakePdf[] = [];

/** Where the fake autotable says its last table ended. */
export const FAKE_TABLE_HEIGHT = 40;

class FakeJsPDF {
  record: FakePdf;
  lastAutoTable = { finalY: 0 };

  constructor(orientation?: string) {
    this.record = { orientation, texts: [], tables: [] };
    pdfDocs.push(this.record);
  }

  setFontSize() {
    return this;
  }

  setFont() {
    return this;
  }

  text(value: string | string[]) {
    this.record.texts.push(...([] as string[]).concat(value));
    return this;
  }

  save(name: string) {
    this.record.savedAs = name;
  }
}

function fakeAutoTable(doc: FakeJsPDF, options: FakeTable) {
  doc.record.tables.push(options);
  doc.lastAutoTable = { finalY: (options.startY ?? 0) + FAKE_TABLE_HEIGHT };
}

export const jspdfModule = { default: FakeJsPDF, jsPDF: FakeJsPDF };
export const autoTableModule = { default: fakeAutoTable };
