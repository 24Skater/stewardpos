import { describe, it, expect } from 'vitest';
import { describeRange, periodRange, toDateInput } from '../report-range';

/**
 * The period presets.
 *
 * Pure and clock-injected on purpose: the reason this is a module rather than a
 * closure inside each page is that three screens offer "Last 7 Days" and they
 * must all mean the same seven days. A test that could not fix "now" would not
 * be able to say so.
 */
const NOW = Date.parse('2026-08-16T14:30:00.000Z');

describe('periodRange', () => {
  it('makes today a single day, not an instant', () => {
    expect(periodRange('today', NOW)).toEqual({ from: '2026-08-16', to: '2026-08-16' });
  });

  it('counts seven calendar days including today', () => {
    // Not `now - 7 days`: a rolling window would change the figure simply
    // because an hour passed, so the same report run twice in an afternoon
    // would print two answers.
    expect(periodRange('7days', NOW)).toEqual({ from: '2026-08-10', to: '2026-08-16' });
  });

  it('counts thirty calendar days including today', () => {
    expect(periodRange('30days', NOW)).toEqual({ from: '2026-07-18', to: '2026-08-16' });
  });

  it('spans a month boundary correctly', () => {
    expect(periodRange('7days', Date.parse('2026-03-02T09:00:00.000Z'))).toEqual({
      from: '2026-02-24',
      to: '2026-03-02',
    });
  });
});

describe('toDateInput', () => {
  it('formats in UTC, matching how the server buckets a day', () => {
    // A late-evening sale formatted in a negative-offset local timezone would
    // land on the previous date here and on this date on the server.
    expect(toDateInput(Date.parse('2026-08-16T23:59:00.000Z'))).toBe('2026-08-16');
  });
});

describe('describeRange', () => {
  it('states a single day once', () => {
    expect(describeRange({ from: '2026-08-16', to: '2026-08-16' })).toBe('2026-08-16');
  });

  it('states a span', () => {
    expect(describeRange({ from: '2026-08-01', to: '2026-08-16' })).toBe('2026-08-01 to 2026-08-16');
  });

  it('says so when there are no bounds', () => {
    expect(describeRange({})).toBe('All time');
  });
});
