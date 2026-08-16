import { describe, it, expect } from 'vitest';
import { diffRecords, formatValue } from '../audit-diff';

/**
 * The audit diff.
 *
 * The screen printed `before` and `after` as two raw JSON blobs, so finding the
 * one field that moved on a twenty-field product meant reading forty lines. This
 * reduces an entry to the question people actually open it with: what changed?
 */
describe('diffRecords', () => {
  it('reports only what changed', () => {
    const changes = diffRecords(
      { name: 'Tea', price: 5, stock: 10 },
      { name: 'Tea', price: 6, stock: 10 }
    );

    expect(changes).toEqual([{ field: 'price', before: 5, after: 6 }]);
  });

  it('reports nothing when nothing moved', () => {
    expect(diffRecords({ price: 5 }, { price: 5 })).toEqual([]);
  });

  it('shows a created record as fields appearing', () => {
    // A create has no `before`. Showing an empty panel would say less than the
    // record itself does.
    expect(diffRecords(null, { name: 'Tea' })).toEqual([
      { field: 'name', before: undefined, after: 'Tea' },
    ]);
  });

  it('shows a deleted record as fields disappearing', () => {
    expect(diffRecords({ name: 'Tea' }, null)).toEqual([
      { field: 'name', before: 'Tea', after: undefined },
    ]);
  });

  it('treats an unchanged nested object as unchanged', () => {
    // Reference equality would report every nested object as changed on every
    // edit, and a diff that flags everything flags nothing.
    const changes = diffRecords(
      { variants: [{ sku: 'A', stock: 1 }], name: 'Tea' },
      { variants: [{ sku: 'A', stock: 1 }], name: 'Coffee' }
    );

    expect(changes.map((c) => c.field)).toEqual(['name']);
  });

  it('notices a change inside a nested object', () => {
    const changes = diffRecords(
      { variants: [{ sku: 'A', stock: 1 }] },
      { variants: [{ sku: 'A', stock: 2 }] }
    );

    expect(changes.map((c) => c.field)).toEqual(['variants']);
  });

  it('distinguishes null from missing', () => {
    expect(diffRecords({ note: null }, { note: 'restocked' })).toEqual([
      { field: 'note', before: null, after: 'restocked' },
    ]);
  });

  it('orders fields predictably', () => {
    // So the same edit does not render its rows in a different order each time
    // the dialog opens.
    const changes = diffRecords({ z: 1, a: 1 }, { z: 2, a: 2 });

    expect(changes.map((c) => c.field)).toEqual(['a', 'z']);
  });

  it('handles both sides being absent', () => {
    expect(diffRecords(undefined, undefined)).toEqual([]);
  });
});

describe('formatValue', () => {
  it('renders a missing field as a dash rather than "undefined"', () => {
    expect(formatValue(undefined)).toBe('—');
  });

  it('distinguishes an explicit null', () => {
    expect(formatValue(null)).toBe('null');
  });

  it('leaves strings alone and serialises objects', () => {
    expect(formatValue('Tea')).toBe('Tea');
    expect(formatValue({ sku: 'A' })).toBe('{"sku":"A"}');
    expect(formatValue(5)).toBe('5');
    expect(formatValue(false)).toBe('false');
  });
});
