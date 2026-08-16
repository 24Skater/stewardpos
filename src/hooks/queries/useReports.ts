import { useQuery } from '@tanstack/react-query';
import { reportsApi, type ReportRangeQuery } from '@/lib/api';
import type { SalesReportData } from '@/components/reports/SalesReport';
import { queryKeys } from './keys';

/**
 * Everything a sales report needs, for one range, in one hook.
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
    // A report is a statement about a closed period; re-fetching it on every
    // window focus buys nothing and costs five queries.
    staleTime: 60_000,
  });
}
