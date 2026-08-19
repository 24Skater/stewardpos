import { useQuery } from '@tanstack/react-query';
import { reportsApi, type ReportRangeQuery, type RegisterHourlyQuery } from '@/lib/api';
import type { SalesReportData } from '@/components/reports/SalesReport';
import type { LossPreventionReportData } from '@/components/reports/LossPreventionReport';
import { queryKeys } from './keys';

/**
 * A report is a statement about a closed period; re-fetching it on every
 * window focus buys nothing and costs an extra round trip. Shared by every
 * hook in this file for that reason.
 */
const REPORT_STALE_TIME = 60_000;

/**
 * Everything a sales report needs, for one range and filter, in one hook.
 *
 * The five calls go out together rather than in sequence — they are independent
 * and waiting on each other would make a report four round trips slower for no
 * reason — and they resolve as a single result, so the screen cannot render a
 * summary card from one period beside a chart from another.
 */
export function useSalesReport(range: ReportRangeQuery) {
  return useQuery<SalesReportData>({
    queryKey: queryKeys.reports.sales(range),
    queryFn: async () => {
      const [summary, byDay, topProducts, paymentMix, returns] = await Promise.all([
        reportsApi.salesSummary(range),
        reportsApi.salesByDay(range),
        reportsApi.topProducts({ ...range, limit: 10 }),
        reportsApi.paymentMix(range),
        reportsApi.returnsSummary(range),
      ]);

      return { summary, byDay, topProducts, paymentMix, returns };
    },
    staleTime: REPORT_STALE_TIME,
  });
}

/**
 * How many sales went through each till, plus the web-vs-drawer split — the
 * report this whole phase exists to answer.
 */
export function useRegisterReport(range: ReportRangeQuery) {
  return useQuery({
    queryKey: queryKeys.reports.registers(range),
    queryFn: () => reportsApi.salesByRegister(range),
    staleTime: REPORT_STALE_TIME,
  });
}

/** Sales attributed to whoever rang them at checkout — what the PIN-and-shift phase exists to make possible. */
export function useCashierReport(range: ReportRangeQuery) {
  return useQuery({
    queryKey: queryKeys.reports.cashiers(range),
    queryFn: () => reportsApi.salesByCashier(range),
    staleTime: REPORT_STALE_TIME,
  });
}

/** Sales rolled up to the site level. */
export function useLocationReport(range: ReportRangeQuery) {
  return useQuery({
    queryKey: queryKeys.reports.locations(range),
    queryFn: () => reportsApi.salesByLocation(range),
    staleTime: REPORT_STALE_TIME,
  });
}

/**
 * The two loss-prevention reports, together: which drawers are closing short
 * and by how much, and which registers are seeing no-sale drawer opens — the
 * best theft signal a POS can report on. Bundled the same way
 * {@link useSalesReport} bundles its five calls, so the screen cannot show a
 * variance table from one period beside a no-sale count from another.
 */
export function useLossPreventionReport(range: ReportRangeQuery) {
  return useQuery<LossPreventionReportData>({
    queryKey: queryKeys.reports.lossPrevention(range),
    queryFn: async () => {
      const [drawerVariance, noSales] = await Promise.all([
        reportsApi.drawerVarianceByRegister(range),
        reportsApi.noSaleCounts(range),
      ]);
      return { drawerVariance, noSales };
    },
    staleTime: REPORT_STALE_TIME,
  });
}

/** One register's trading by hour of its location's local day, for staffing decisions. */
export function useRegisterHourly(registerId: string | undefined, range: ReportRangeQuery) {
  return useQuery({
    queryKey: queryKeys.reports.hourly(registerId ?? '', range),
    queryFn: () => reportsApi.registerHourly({ ...range, registerId: registerId as string } as RegisterHourlyQuery),
    enabled: Boolean(registerId),
    staleTime: REPORT_STALE_TIME,
  });
}
