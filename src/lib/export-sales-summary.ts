/**
 * The sales summary export.
 *
 * Built from the reporting API payload the screen already holds, not from a list
 * of orders. Every other report in `export-utils.ts` re-derives its figures from
 * raw rows, which is exactly how an export comes to disagree with the page it
 * was exported from — two implementations of "revenue", one counting tax and one
 * not. Here there is one set of figures and several renderings of it.
 */
import type { ExportRow, Settings, AutoTableDoc } from './export-core';
import { cellNum, cellStr, createPDFHeader, exportToCSV, exportToExcel, loadPdfKit } from './export-core';

/**
 * The sales summary, as sheets, built from the reporting API payload.
 *
 * Deliberately takes the same object the screen renders rather than a list of
 * orders. Every other report in this file re-derives its figures from raw rows,
 * which is how an export comes to disagree with the page it was exported from:
 * two implementations of "revenue", one of which counts tax and one of which
 * does not. Here there is one set of figures and two renderings of it.
 */
/** One register's totals, as `sales-by-register` returns it. */
export interface SalesSummaryRegister {
  displayCode: string;
  name: string;
  locationName: string;
  type: string;
  hasCashDrawer: boolean;
  status: string;
  orderCount: number;
  net: number;
  avgTicket: number;
}

/** One cashier's totals, as `sales-by-cashier` returns it. */
export interface SalesSummaryCashier {
  cashierUserId: string;
  cashierName: string;
  orderCount: number;
  net: number;
  avgTicket: number;
}

export interface SalesSummaryExport {
  summary: {
    from: number;
    to: number;
    orderCount: number;
    gross: number;
    discounts: number;
    tax: number;
    net: number;
    refunds: number;
    netAfterRefunds: number;
    avgTicket: number;
    pendingRefunds: number;
  };
  byDay: { date: string; orderCount: number; gross: number; net: number }[];
  topProducts: { productId: string; name: string; quantity: number; revenue: number }[];
  paymentMix: { method: string; count: number; amount: number }[];
  returns: { byReason: { reasonCode: string; returnCount: number; refunded: number }[] };
  /**
   * Optional: the register and cashier breakdown, when the caller fetched
   * them alongside the summary. Omitted entirely (not an empty array) by a
   * caller that has no reason to pull them, so an export built before this
   * phase existed still type-checks and still prints the same document.
   */
  byRegister?: SalesSummaryRegister[];
  byCashier?: SalesSummaryCashier[];
}

/** `YYYY-MM-DD` in UTC, matching how the server buckets a day. */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function describeExportRange(summary: SalesSummaryExport['summary']): string {
  const from = isoDay(summary.from);
  const to = isoDay(summary.to);
  return from === to ? from : `${from} to ${to}`;
}

export function generateSalesSummaryReport(data: SalesSummaryExport): {
  totals: ExportRow[];
  byDay: ExportRow[];
  topProducts: ExportRow[];
  paymentMix: ExportRow[];
  returnsByReason: ExportRow[];
  byRegister: ExportRow[];
  byCashier: ExportRow[];
} {
  const { summary } = data;

  return {
    // A label/value shape rather than one wide row: this sheet is read by a
    // person reconciling a period, not summed by a machine.
    totals: [
      { Measure: 'Period', Value: describeExportRange(summary) },
      { Measure: 'Orders', Value: summary.orderCount },
      { Measure: 'Gross sales', Value: summary.gross },
      { Measure: 'Discounts', Value: summary.discounts },
      { Measure: 'Tax collected', Value: summary.tax },
      { Measure: 'Net sales', Value: summary.net },
      { Measure: 'Refunds (completed)', Value: summary.refunds },
      { Measure: 'Refunds (pending approval)', Value: summary.pendingRefunds },
      { Measure: 'Kept after refunds', Value: summary.netAfterRefunds },
      { Measure: 'Average ticket', Value: summary.avgTicket },
    ],
    byDay: data.byDay.map((day) => ({
      Date: day.date,
      Orders: day.orderCount,
      Gross: day.gross,
      Net: day.net,
    })),
    topProducts: data.topProducts.map((product) => ({
      Product: product.name,
      Quantity: product.quantity,
      Revenue: product.revenue,
    })),
    paymentMix: data.paymentMix.map((row) => ({
      Method: row.method,
      Sales: row.count,
      Amount: row.amount,
    })),
    returnsByReason: data.returns.byReason.map((row) => ({
      Reason: row.reasonCode,
      Returns: row.returnCount,
      Refunded: row.refunded,
    })),
    byRegister: (data.byRegister ?? []).map((row) => ({
      Register: `${row.displayCode} — ${row.name}`,
      Location: row.locationName,
      Type: row.type,
      Drawer: row.hasCashDrawer ? 'Yes' : 'No',
      Status: row.status,
      Transactions: row.orderCount,
      Net: row.net,
      'Avg Ticket': row.avgTicket,
    })),
    byCashier: (data.byCashier ?? []).map((row) => ({
      Cashier: row.cashierUserId === 'unknown' ? 'Unattributed (before shift tracking)' : row.cashierName,
      Transactions: row.orderCount,
      Net: row.net,
      'Avg Ticket': row.avgTicket,
    })),
  };
}

/** The workbook shape, one sheet per section. */
export function salesSummarySheets(data: SalesSummaryExport): { name: string; data: ExportRow[] }[] {
  const report = generateSalesSummaryReport(data);

  return [
    { name: 'Summary', data: report.totals },
    { name: 'By Day', data: report.byDay },
    { name: 'Top Products', data: report.topProducts },
    { name: 'Payment Mix', data: report.paymentMix },
    { name: 'Returns by Reason', data: report.returnsByReason },
    { name: 'By Register', data: report.byRegister },
    { name: 'By Cashier', data: report.byCashier },
  ];
}

export async function exportSalesSummaryToPDF(data: SalesSummaryExport, settings?: Settings) {
  const { jsPDFCtor, autoTable } = await loadPdfKit();
  const doc = new jsPDFCtor();
  const report = generateSalesSummaryReport(data);

  const startY = createPDFHeader(
    doc,
    'Sales Summary',
    // The period, not the print date: what makes this document reconcilable is
    // knowing which days it covers.
    `${describeExportRange(data.summary)}  ·  generated ${new Date().toLocaleDateString()}`,
    settings
  );

  autoTable(doc, {
    startY,
    head: [['Measure', 'Value']],
    body: report.totals.map((row) => [
      cellStr(row.Measure),
      typeof row.Value === 'number' ? `$${cellNum(row.Value).toFixed(2)}` : cellStr(row.Value),
    ]),
    theme: 'striped',
    headStyles: { fillColor: [99, 102, 241] },
  });

  const sections: [string, string[], (string | number)[][]][] = [
    [
      'Sales by day',
      ['Date', 'Orders', 'Gross', 'Net'],
      report.byDay.map((row) => [
        cellStr(row.Date),
        cellNum(row.Orders),
        `$${cellNum(row.Gross).toFixed(2)}`,
        `$${cellNum(row.Net).toFixed(2)}`,
      ]),
    ],
    [
      'Top products',
      ['Product', 'Qty', 'Revenue'],
      report.topProducts.map((row) => [
        cellStr(row.Product),
        cellNum(row.Quantity),
        `$${cellNum(row.Revenue).toFixed(2)}`,
      ]),
    ],
    [
      'How it was paid',
      ['Method', 'Sales', 'Amount'],
      report.paymentMix.map((row) => [
        cellStr(row.Method),
        cellNum(row.Sales),
        `$${cellNum(row.Amount).toFixed(2)}`,
      ]),
    ],
    [
      'Returns by reason',
      ['Reason', 'Returns', 'Refunded'],
      report.returnsByReason.map((row) => [
        cellStr(row.Reason),
        cellNum(row.Returns),
        `$${cellNum(row.Refunded).toFixed(2)}`,
      ]),
    ],
    [
      'Sales by register',
      ['Register', 'Location', 'Drawer', 'Transactions', 'Net', 'Avg Ticket'],
      report.byRegister.map((row) => [
        cellStr(row.Register),
        cellStr(row.Location),
        cellStr(row.Drawer),
        cellNum(row.Transactions),
        `$${cellNum(row.Net).toFixed(2)}`,
        `$${cellNum(row['Avg Ticket']).toFixed(2)}`,
      ]),
    ],
    [
      'Sales by cashier',
      ['Cashier', 'Transactions', 'Net', 'Avg Ticket'],
      report.byCashier.map((row) => [
        cellStr(row.Cashier),
        cellNum(row.Transactions),
        `$${cellNum(row.Net).toFixed(2)}`,
        `$${cellNum(row['Avg Ticket']).toFixed(2)}`,
      ]),
    ],
  ];

  for (const [title, head, body] of sections) {
    // An empty section is omitted rather than printed as a heading over
    // nothing, which reads as a rendering failure.
    if (body.length === 0) continue;

    const y = (doc as AutoTableDoc).lastAutoTable.finalY + 12;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(title, 14, y);

    autoTable(doc, {
      startY: y + 4,
      head: [head],
      body,
      theme: 'striped',
      headStyles: { fillColor: [99, 102, 241] },
    });
  }

  doc.save(`sales-summary-${isoDay(data.summary.from)}-to-${isoDay(data.summary.to)}.pdf`);
}

/** The flat rows a single-file CSV carries: the totals sheet. */
export function exportSalesSummaryToCSV(data: SalesSummaryExport) {
  exportToCSV(
    generateSalesSummaryReport(data).totals,
    `sales-summary-${isoDay(data.summary.from)}-to-${isoDay(data.summary.to)}.csv`
  );
}

export async function exportSalesSummaryToExcel(data: SalesSummaryExport) {
  await exportToExcel(
    salesSummarySheets(data),
    `sales-summary-${isoDay(data.summary.from)}-to-${isoDay(data.summary.to)}.xlsx`
  );
}
