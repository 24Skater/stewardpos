import type { RegisterHourly } from './reports.types';

/**
 * Buckets a register's orders into the hour of day they fell in, **local to a
 * given IANA timezone**.
 *
 * This runs in TypeScript rather than SQL, and that is a deliberate choice
 * documented here because the alternative was tried first and does not work
 * across both dialects. Postgres can convert a timestamp into an arbitrary
 * IANA zone with `AT TIME ZONE` — SQLite cannot. SQLite's date functions only
 * understand fixed numeric UTC offsets (`'+05:30'`), not zone names, and have
 * no concept of daylight saving. A `locations.timezone` value like
 * `'America/New_York'` is exactly the case that breaks: the offset from UTC
 * changes twice a year, and any single fixed-offset translation baked into
 * SQL would misbucket half the year's orders by an hour. Doing this in SQL
 * would mean two adapters that quietly disagree about which hour a sale
 * happened in — worse than doing it in one place in TypeScript, where
 * `Intl.DateTimeFormat` carries a real timezone database.
 *
 * Both adapters fetch the same two things — the register's raw `(createdAt,
 * total)` order rows, and its location's `timezone` string — and hand them to
 * this one function, so the bucketing logic itself exists exactly once.
 */
export function bucketOrdersByLocalHour(
  orders: { createdAt: number; total: number }[],
  timezone: string
): RegisterHourly[] {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });

  const byHour = new Map<number, { orderCount: number; netCents: number }>();

  for (const order of orders) {
    const hourPart = formatter.formatToParts(new Date(order.createdAt)).find(
      (part) => part.type === 'hour'
    );
    // `hour12: false` renders midnight as "24" for the `en-US` locale in some
    // ICU versions rather than "0" — `% 24` normalises that back to the 0–23
    // range the rest of the API promises.
    const hour = hourPart ? Number(hourPart.value) % 24 : 0;

    const bucket = byHour.get(hour) ?? { orderCount: 0, netCents: 0 };
    bucket.orderCount += 1;
    // Integer cents, not running dollar addition: summing dollars as
    // floating-point numbers across many orders drifts exactly the way
    // `pricing.ts` describes, and an hourly chart is read the same as any
    // other report.
    bucket.netCents += Math.round(order.total * 100);
    byHour.set(hour, bucket);
  }

  return Array.from(byHour.entries())
    .sort(([a], [b]) => a - b)
    .map(([hour, bucket]) => ({
      hour,
      orderCount: bucket.orderCount,
      net: bucket.netCents / 100,
    }));
}
