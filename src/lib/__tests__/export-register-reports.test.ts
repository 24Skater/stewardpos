import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/**
 * The register-reporting exports: sales by register, sales by cashier, drawer
 * variance, and no-sale counts. Asserts the columns a downloaded file carries,
 * since those are exactly the figures `RegisterReport`/`CashierReport` show on
 * screen — an export that dropped a column would say less than the report it
 * was exported from.
 */
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
    if (downloads.length > 0) downloads[downloads.length - 1].name = this.download;
  });
});

const {
  generateRegisterReport,
  generateCashierReport,
  generateDrawerVarianceReport,
  generateNoSaleReport,
  exportRegisterReportToCSV,
  exportCashierReportToCSV,
} = await import('../export-register-reports');

import type { CashierSales, DrawerVarianceByRegister, NoSaleCount, RegisterSales } from '@/lib/api';

const REGISTERS: RegisterSales[] = [
  {
    registerId: 'r-main',
    displayCode: 'MAIN-01',
    name: 'Front Counter',
    locationId: 'loc-1',
    locationName: 'Main Street',
    type: 'fixed',
    hasCashDrawer: true,
    status: 'active',
    orderCount: 10,
    gross: 200,
    discounts: 5,
    tax: 15,
    net: 210,
    avgTicket: 21,
  },
  {
    registerId: 'r-web',
    displayCode: 'WEB-01',
    name: 'Online Store',
    locationId: 'loc-1',
    locationName: 'Main Street',
    type: 'web',
    hasCashDrawer: false,
    status: 'retired',
    orderCount: 4,
    gross: 80,
    discounts: 0,
    tax: 6,
    net: 86,
    avgTicket: 21.5,
  },
];

const CASHIERS: CashierSales[] = [
  { cashierUserId: 'u1', cashierName: 'Alex', orderCount: 6, gross: 120, net: 118, avgTicket: 19.67 },
  { cashierUserId: 'unknown', cashierName: 'Unknown', orderCount: 1, gross: 10, net: 10, avgTicket: 10 },
];

const VARIANCE: DrawerVarianceByRegister[] = [
  {
    registerId: 'r-main',
    displayCode: 'MAIN-01',
    name: 'Front Counter',
    sessionCount: 5,
    totalVariance: -12.5,
    worstVariance: -8,
    shortCount: 2,
  },
];

const NO_SALES: NoSaleCount[] = [
  { registerId: 'r-main', displayCode: 'MAIN-01', name: 'Front Counter', noSaleCount: 7 },
];

beforeEach(() => {
  downloads.length = 0;
});

describe('generateRegisterReport', () => {
  it('carries the register, drawer, and status columns through unchanged', () => {
    const rows = generateRegisterReport(REGISTERS);

    expect(rows[0]).toEqual({
      Register: 'MAIN-01 — Front Counter',
      Location: 'Main Street',
      Type: 'fixed',
      Drawer: 'Yes',
      Status: 'active',
      Transactions: 10,
      Net: 210,
      'Avg Ticket': 21,
    });
    expect(rows[1].Drawer).toBe('No');
    expect(rows[1].Status).toBe('retired');
  });
});

describe('generateCashierReport', () => {
  it('carries the cashier and net columns through unchanged', () => {
    const rows = generateCashierReport(CASHIERS);

    expect(rows[0]).toEqual({ Cashier: 'Alex', Transactions: 6, Net: 118, 'Avg Ticket': 19.67 });
    expect(rows[1].Cashier).toBe('Unattributed (before shift tracking)');
  });
});

describe('generateDrawerVarianceReport', () => {
  it('carries the variance figures through unchanged', () => {
    const rows = generateDrawerVarianceReport(VARIANCE);

    expect(rows[0]).toEqual({
      Register: 'MAIN-01 — Front Counter',
      Sessions: 5,
      'Short Sessions': 2,
      'Total Variance': -12.5,
      'Worst Session': -8,
    });
  });
});

describe('generateNoSaleReport', () => {
  it('carries the no-sale count through unchanged', () => {
    expect(generateNoSaleReport(NO_SALES)).toEqual([
      { Register: 'MAIN-01 — Front Counter', 'No-Sale Opens': 7 },
    ]);
  });
});

describe('exporting', () => {
  it('writes a register CSV with the register and drawer columns', async () => {
    exportRegisterReportToCSV(REGISTERS, { from: '2026-08-01', to: '2026-08-16' });

    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('sales-by-register-2026-08-01-to-2026-08-16.csv');
    const text = await downloads[0].blob.text();
    expect(text).toContain('Register,Location,Type,Drawer,Status,Transactions,Net,Avg Ticket');
    expect(text).toContain('MAIN-01 — Front Counter');
  });

  it('writes a cashier CSV with the cashier column', async () => {
    exportCashierReportToCSV(CASHIERS, { from: '2026-08-01', to: '2026-08-16' });

    expect(downloads).toHaveLength(1);
    const text = await downloads[0].blob.text();
    expect(text).toContain('Cashier,Transactions,Net,Avg Ticket');
    expect(text).toContain('Alex');
  });
});
