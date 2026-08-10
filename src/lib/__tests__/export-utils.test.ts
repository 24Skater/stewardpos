import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  exportToCSV,
  generateSalesByCustomerReport,
  generateSalesByItemReport,
  generateCustomerListReport,
} from '../export-utils';

/**
 * Export and report generation.
 *
 * These are the numbers a shop takes to its accountant, so an aggregation that
 * double-counts or a CSV that breaks on a comma is not a cosmetic problem. 891
 * lines of this had no coverage at all.
 */

/** The text handed to the Blob, which is what actually lands in the file. */
let written: string;

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
  // jsdom will happily create the anchor; clicking it must not navigate.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('exportToCSV', () => {
  it('writes a header row from the keys', () => {
    exportToCSV([{ Name: 'Tea', Price: 5 }], 'out.csv');

    expect(written.split('\n')[0]).toBe('Name,Price');
  });

  it('quotes a value containing a comma', () => {
    // Unquoted, "Lovelace, Ada" becomes two columns and every field after it
    // shifts — the whole row silently misaligns.
    exportToCSV([{ Name: 'Lovelace, Ada' }], 'out.csv');

    expect(written.split('\n')[1]).toBe('"Lovelace, Ada"');
  });

  it('doubles an embedded quote, as CSV requires', () => {
    exportToCSV([{ Name: 'The "Good" Stuff' }], 'out.csv');

    expect(written.split('\n')[1]).toBe('"The ""Good"" Stuff"');
  });

  it('quotes a value containing a newline', () => {
    exportToCSV([{ Notes: 'line one\nline two' }], 'out.csv');

    expect(written).toContain('"line one\nline two"');
  });

  it('writes an empty field for null and undefined rather than the word', () => {
    // "null" in a spreadsheet cell reads as data.
    exportToCSV([{ A: null, B: undefined, C: 1 }], 'out.csv');

    expect(written.split('\n')[1]).toBe(',,1');
  });

  it('leaves an ordinary value unquoted', () => {
    exportToCSV([{ Name: 'Tea' }], 'out.csv');

    expect(written.split('\n')[1]).toBe('Tea');
  });

  it('does nothing at all for an empty export', () => {
    exportToCSV([], 'out.csv');

    expect(written).toBe('');
  });
});

describe('generateSalesByCustomerReport', () => {
  const orders = [
    { id: 'o1', customerEmail: 'ada@example.com', total: 100 },
    { id: 'o2', customerEmail: 'ada@example.com', total: 50 },
    { id: 'o3', customerEmail: 'grace@example.com', total: 30 },
  ] as never[];
  const customers = [
    { id: 'c1', name: 'Ada Lovelace', email: 'ada@example.com' },
    { id: 'c2', name: 'Grace Hopper', email: 'grace@example.com' },
  ] as never[];

  it('sums revenue per customer', () => {
    const report = generateSalesByCustomerReport(orders, customers);

    expect(report.find((r) => r.Email === 'ada@example.com')!['Total Revenue']).toBe(150);
  });

  it('counts their orders', () => {
    const report = generateSalesByCustomerReport(orders, customers);

    expect(report.find((r) => r.Email === 'ada@example.com')!['Order Count']).toBe(2);
  });

  it('averages correctly', () => {
    const report = generateSalesByCustomerReport(orders, customers);

    expect(report.find((r) => r.Email === 'ada@example.com')!['Avg Order Value']).toBe(75);
  });

  it('ranks by revenue, highest first', () => {
    const report = generateSalesByCustomerReport(orders, customers);

    expect(report.map((r) => r['Total Revenue'])).toEqual([150, 30]);
  });

  it('groups anonymous sales under Walk-in rather than dropping them', () => {
    // A shop's walk-in trade is often most of its revenue; losing it from the
    // report would understate takings badly.
    const report = generateSalesByCustomerReport(
      [{ id: 'o1', total: 20 }] as never[],
      [] as never[]
    );

    expect(report).toHaveLength(1);
    expect(report[0]['Total Revenue']).toBe(20);
  });

  it('handles an order whose customer is not in the list', () => {
    const report = generateSalesByCustomerReport(
      [{ id: 'o1', customerEmail: 'ghost@example.com', total: 10 }] as never[],
      [] as never[]
    );

    expect(report[0]['Total Revenue']).toBe(10);
  });

  it('produces nothing from no orders', () => {
    expect(generateSalesByCustomerReport([] as never[], customers)).toEqual([]);
  });
});

describe('generateSalesByItemReport', () => {
  it('aggregates quantity and revenue across orders', () => {
    const orders = [
      { id: 'o1', items: [{ nameSnapshot: 'Tea', quantity: 2, lineTotal: 10 }] },
      { id: 'o2', items: [{ nameSnapshot: 'Tea', quantity: 3, lineTotal: 15 }] },
    ] as never[];

    const report = generateSalesByItemReport(orders);
    const tea = report.find((r) => Object.values(r).includes('Tea'));

    expect(tea).toBeTruthy();
    expect(Object.values(tea!)).toContain(25);
  });

  it('copes with an order carrying no items', () => {
    expect(() => generateSalesByItemReport([{ id: 'o1', items: [] }] as never[])).not.toThrow();
  });
});

describe('generateCustomerListReport', () => {
  it('produces a row per customer', () => {
    const report = generateCustomerListReport([
      { id: 'c1', name: 'Ada', email: 'ada@example.com' },
      { id: 'c2', name: 'Grace', email: 'grace@example.com' },
    ] as never[]);

    expect(report).toHaveLength(2);
  });

  it('produces nothing from an empty list', () => {
    expect(generateCustomerListReport([] as never[])).toEqual([]);
  });
});
