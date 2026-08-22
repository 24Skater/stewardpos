/**
 * The register-reporting exports: sales by register, sales by cashier, drawer
 * variance, and no-sale counts.
 *
 * Built from the reporting API payloads the same way `export-sales-summary.ts`
 * is — the figures are exactly what the report screens show, not re-derived
 * from a list of orders, so an export cannot disagree with the screen it was
 * exported from. Only CSV and Excel writers: these are secondary reports next
 * to the sales summary, and this codebase already has that precedent —
 * `services-category` and `returns-monthly` are Excel/CSV only too.
 */
import type { ExportRow } from './export-core';
import { exportToCSV, exportToExcel } from './export-core';
import type {
  CashierSales,
  DrawerVarianceByRegister,
  NoSaleCount,
  RegisterSales,
} from '@/lib/api';

/** `YYYY-MM-DD` in UTC, matching how the server buckets a day. */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function generateRegisterReport(rows: RegisterSales[]): ExportRow[] {
  return rows.map((row) => ({
    Register: `${row.displayCode} — ${row.name}`,
    Location: row.locationName,
    Type: row.type,
    Drawer: row.hasCashDrawer ? 'Yes' : 'No',
    Status: row.status,
    Transactions: row.orderCount,
    Net: row.net,
    'Avg Ticket': row.avgTicket,
  }));
}

export function generateCashierReport(rows: CashierSales[]): ExportRow[] {
  return rows.map((row) => ({
    Cashier: row.cashierUserId === 'unknown' ? 'Unattributed (before shift tracking)' : row.cashierName,
    Transactions: row.orderCount,
    Net: row.net,
    'Avg Ticket': row.avgTicket,
  }));
}

export function generateDrawerVarianceReport(rows: DrawerVarianceByRegister[]): ExportRow[] {
  return rows.map((row) => ({
    Register: `${row.displayCode} — ${row.name}`,
    Sessions: row.sessionCount,
    'Short Sessions': row.shortCount,
    'Total Variance': row.totalVariance,
    'Worst Session': row.worstVariance,
  }));
}

export function generateNoSaleReport(rows: NoSaleCount[]): ExportRow[] {
  return rows.map((row) => ({
    Register: `${row.displayCode} — ${row.name}`,
    'No-Sale Opens': row.noSaleCount,
  }));
}

/** `range` names the export file, the same way the sales-summary export is named for its period. */
function periodSuffix(range?: { from?: string; to?: string }): string {
  if (!range?.from && !range?.to) return isoDay(Date.now());
  if (!range.from) return range.to as string;
  if (!range.to) return range.from;
  return range.from === range.to ? range.from : `${range.from}-to-${range.to}`;
}

export function exportRegisterReportToCSV(rows: RegisterSales[], range?: { from?: string; to?: string }): boolean {
  return exportToCSV(generateRegisterReport(rows), `sales-by-register-${periodSuffix(range)}.csv`);
}

export async function exportRegisterReportToExcel(
  rows: RegisterSales[],
  range?: { from?: string; to?: string }
): Promise<boolean> {
  return exportToExcel(
    [{ name: 'Sales by Register', data: generateRegisterReport(rows) }],
    `sales-by-register-${periodSuffix(range)}.xlsx`
  );
}

export function exportCashierReportToCSV(rows: CashierSales[], range?: { from?: string; to?: string }): boolean {
  return exportToCSV(generateCashierReport(rows), `sales-by-cashier-${periodSuffix(range)}.csv`);
}

export async function exportCashierReportToExcel(
  rows: CashierSales[],
  range?: { from?: string; to?: string }
): Promise<boolean> {
  return exportToExcel(
    [{ name: 'Sales by Cashier', data: generateCashierReport(rows) }],
    `sales-by-cashier-${periodSuffix(range)}.xlsx`
  );
}

export function exportDrawerVarianceReportToCSV(
  rows: DrawerVarianceByRegister[],
  range?: { from?: string; to?: string }
): boolean {
  return exportToCSV(generateDrawerVarianceReport(rows), `drawer-variance-${periodSuffix(range)}.csv`);
}

export async function exportDrawerVarianceReportToExcel(
  rows: DrawerVarianceByRegister[],
  range?: { from?: string; to?: string }
): Promise<boolean> {
  return exportToExcel(
    [{ name: 'Drawer Variance', data: generateDrawerVarianceReport(rows) }],
    `drawer-variance-${periodSuffix(range)}.xlsx`
  );
}

export function exportNoSaleReportToCSV(rows: NoSaleCount[], range?: { from?: string; to?: string }): boolean {
  return exportToCSV(generateNoSaleReport(rows), `no-sale-counts-${periodSuffix(range)}.csv`);
}

export async function exportNoSaleReportToExcel(
  rows: NoSaleCount[],
  range?: { from?: string; to?: string }
): Promise<boolean> {
  return exportToExcel(
    [{ name: 'No-Sale Counts', data: generateNoSaleReport(rows) }],
    `no-sale-counts-${periodSuffix(range)}.xlsx`
  );
}
