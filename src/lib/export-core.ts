/**
 * The primitives every exported report is built from.
 *
 * Split out of `export-utils.ts` when that file crossed the 800-line ceiling the
 * repo conventions set. Everything here is shared machinery — the lazily loaded
 * PDF kit, the CSV and workbook writers, the branded page header, and the cell
 * coercions — with no knowledge of any particular report.
 */
import type jsPDF from 'jspdf';

/**
 * jspdf, jspdf-autotable and xlsx are loaded on demand, not at import.
 *
 * Together they are the better part of a megabyte, and they exist to serve a
 * button a manager presses occasionally. Imported statically they landed in the
 * bundle every cashier downloads before ringing the first sale of the day.
 *
 * The cost is that every function which reaches for them is now async. Callers
 * fire these from click handlers and ignore the result, so nothing had to
 * change at the call sites — but an awaited caller now gets a promise that
 * settles when the file is actually saved, which is more honest than the old
 * signature was.
 */
export async function loadPdfKit() {
  const [{ default: jsPDFCtor }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  return { jsPDFCtor, autoTable };
}

/**
 * One row of an exported report: column label -> cell value.
 *
 * Report rows are built dynamically and keyed by human-readable column names
 * ("Total Revenue"), so the key set is not known statically. Values are constrained
 * to primitives because that is what a CSV or spreadsheet cell can hold; numeric
 * work on a cell needs an explicit Number() at the call site.
 */
export type ExportRow = Record<string, string | number | boolean | null | undefined>;

/**
 * Read a report cell as a number.
 *
 * Report rows are assembled from mixed sources, so a numeric column can arrive as a
 * string. Coercing explicitly avoids the silent bug where `sum + cell` concatenates
 * instead of adding.
 */
export function cellNum(value: ExportRow[string]): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Read a report cell as a string. */
export function cellStr(value: ExportRow[string]): string {
  return value == null ? '' : String(value);
}

/** jsPDF instance after jspdf-autotable has run, which attaches lastAutoTable. */
export type AutoTableDoc = jsPDF & { lastAutoTable: { finalY: number } };

export interface Settings {
  storeName?: string;
  storeEmail?: string;
  storePhone?: string;
}

// ========== UTILITY FUNCTIONS ==========

/**
 * Write rows to a CSV file, and say whether a file was actually written.
 *
 * The header row is taken from the first record's keys, so there is nothing
 * to write when there are no records — not even a header. Returning that
 * fact rather than swallowing it is what lets a caller tell an empty report
 * from a completed one; reporting success over a download that never happened
 * leaves the operator believing they have figures they do not have.
 */
export function exportToCSV(data: ExportRow[], filename: string): boolean {
  if (data.length === 0) return false;

  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row => 
      headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    )
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();

  return true;
}

/** Excel refuses a sheet name longer than this. */
const MAX_SHEET_NAME = 31;

/**
 * The type a column should be written as, taken from its first real value.
 *
 * Report rows are keyed by human-readable labels built at runtime ("Total
 * Revenue"), so there is no static schema to declare — it is derived from the
 * data, the same way `exportToCSV` derives its header row.
 *
 * Deriving the type rather than defaulting everything to text matters because
 * these are the figures a shop hands its accountant: a revenue column written
 * as strings will not sum in Excel, which reads as a spreadsheet bug rather
 * than an export one.
 */
function columnType(column: string, rows: ExportRow[]): 'number' | 'boolean' | 'string' {
  const sample = rows.find((row) => row[column] !== null && row[column] !== undefined)?.[column];

  if (typeof sample === 'number') return 'number';
  if (typeof sample === 'boolean') return 'boolean';
  return 'string';
}

/** One cell, typed to match its column, or blank. */
function cellFor(raw: ExportRow[string], type: ReturnType<typeof columnType>) {
  if (raw === null || raw === undefined || raw === '') return null;

  if (type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    // A value that will not parse is left blank rather than written as a
    // number cell containing NaN, which Excel shows as an error.
    return Number.isFinite(n) ? { value: n, type: Number as NumberConstructor } : null;
  }

  if (type === 'boolean') {
    return typeof raw === 'boolean' ? { value: raw, type: Boolean as BooleanConstructor } : null;
  }

  return { value: String(raw), type: String as StringConstructor };
}

/**
 * Write one or more report sheets to a workbook.
 *
 * Backed by `write-excel-file` rather than SheetJS. `xlsx` on npm stops at
 * 0.18.5 and carries two high advisories — prototype pollution and a ReDoS —
 * with fixes published only to the vendor's own CDN. Nothing here ever *reads*
 * a spreadsheet, which is where both advisories live, but a dependency that
 * cannot be patched from npm is not worth keeping for five lines of use.
 */
export async function exportToExcel(
  sheets: { name: string; data: ExportRow[] }[],
  filename: string
): Promise<boolean> {
  // The browser entry point specifically: it hands the workbook to the browser
  // as a download. `write-excel-file` publishes no bare export, only subpaths,
  // and the node one writes to a filesystem this code does not have.
  const { default: writeXlsxFile } = await import('write-excel-file/browser');

  // A sheet with no rows has no columns to describe either. Excel rejects a
  // workbook with no sheets at all, so an export with nothing in it writes
  // nothing rather than handing someone a corrupt file.
  // Reported as `false` rather than swallowed, for the same reason
  // `exportToCSV` reports it — see the note there.
  const populated = sheets.filter((sheet) => sheet.data.length > 0);
  if (populated.length === 0) return false;

  // Rows are built directly rather than through the objects-plus-schema form,
  // because that form covers a single sheet only — a multi-sheet workbook takes
  // rendered rows, and these exports routinely carry more than one sheet.
  const workbook = populated.map((sheet) => {
    const columns = Object.keys(sheet.data[0]);
    const types = columns.map((column) => columnType(column, sheet.data));

    return {
      sheet: sheet.name.substring(0, MAX_SHEET_NAME),
      data: [
        columns.map((column) => ({ value: column, fontWeight: 'bold' as const })),
        ...sheet.data.map((row) => columns.map((column, i) => cellFor(row[column], types[i]))),
      ],
    };
  });

  // v4's browser entry returns `{ toBlob, toFile }` rather than taking a
  // `fileName` option the way earlier majors did.
  await writeXlsxFile(workbook).toFile(filename);

  return true;
}

export function createPDFHeader(doc: jsPDF, title: string, subtitle?: string, settings?: Settings) {
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(settings?.storeName || 'Steward · Register', 14, 20);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  if (settings?.storeEmail) doc.text(settings.storeEmail, 14, 28);
  if (settings?.storePhone) doc.text(settings.storePhone, 14, 34);
  
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 48);
  
  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(subtitle, 14, 56);
  }
  
  return subtitle ? 64 : 56;
}

export function getMonthName(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

export function getWeekLabel(date: Date): string {
  const startOfWeek = new Date(date);
  startOfWeek.setDate(date.getDate() - date.getDay());
  return `Week of ${startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
