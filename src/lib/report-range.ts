import type { ReportRangeQuery } from './api';

/**
 * The reporting period a screen is showing.
 *
 * Kept as a pure function of "now" so it can be tested without a clock and so
 * every report screen resolves a preset the same way. Two screens labelled
 * "Last 7 Days" that disagree about which seven days is exactly the class of
 * discrepancy the server-side reporting work exists to remove.
 */
export type ReportPeriod = 'today' | '7days' | '30days' | 'custom';

export const PERIOD_LABELS: Record<Exclude<ReportPeriod, 'custom'>, string> = {
  today: 'Today',
  '7days': 'Last 7 Days',
  '30days': 'Last 30 Days',
};

/**
 * A date as `YYYY-MM-DD` in **UTC**.
 *
 * UTC because that is how the server buckets days — see the note in the SQLite
 * adapter. Formatting these in local time would put a sale into a different day
 * on the axis than the one it was counted in.
 */
export function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolve a preset to the `?from=&to=` the API takes.
 *
 * Whole days, not rolling windows: "Last 7 Days" means the last seven calendar
 * days including today, so the figure does not change simply because an hour
 * passed. Both ends are inclusive, which is how the API reads them.
 */
export function periodRange(period: ReportPeriod, now: number = Date.now()): ReportRangeQuery {
  const to = toDateInput(now);

  switch (period) {
    case 'today':
      return { from: to, to };
    case '7days':
      return { from: toDateInput(now - 6 * MS_PER_DAY), to };
    case '30days':
    case 'custom':
    default:
      return { from: toDateInput(now - 29 * MS_PER_DAY), to };
  }
}

/** A period as a human phrase, for a report header or an exported PDF. */
export function describeRange(range: ReportRangeQuery): string {
  if (!range.from || !range.to) return 'All time';
  return range.from === range.to ? range.from : `${range.from} to ${range.to}`;
}
