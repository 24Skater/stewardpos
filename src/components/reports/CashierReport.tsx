import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { money } from './SalesReport';
import { ReportLoadingState } from './ReportLoadingState';
import type { CashierSales } from '@/lib/api';

export interface CashierReportProps {
  data: CashierSales[] | null;
  loading: boolean;
  error: string | null;
}

/**
 * Sales attributed to whoever was actually standing at the till — the report
 * the whole PIN-and-shift phase existed to make possible.
 *
 * `cashierUserId: 'unknown'` is the backend's bucket for orders that predate
 * the migration that started recording who rang a sale; it is shown as its
 * own labelled row rather than dropped, so the total still reconciles with
 * the unfiltered range.
 */
export default function CashierReport({ data, loading, error }: CashierReportProps) {
  if (loading) return <ReportLoadingState />;

  if (error) {
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>The cashier report could not be loaded</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">{error}</CardContent>
      </Card>
    );
  }

  if (!data) return null;

  // Net descending, same as the register report: who is bringing in the most.
  const rows = [...data].sort((a, b) => b.net - a.net);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales by cashier</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            No cashier activity was recorded in this period
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Cashier</TableHead>
                  <TableHead scope="col" className="text-right">
                    Transactions
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Net
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Avg ticket
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((cashier) => (
                  <TableRow key={cashier.cashierUserId}>
                    <TableCell className="font-medium">
                      {cashier.cashierUserId === 'unknown'
                        ? 'Unattributed (before shift tracking)'
                        : cashier.cashierName}
                    </TableCell>
                    <TableCell className="text-right">{cashier.orderCount}</TableCell>
                    <TableCell className="text-right font-semibold">{money(cashier.net)}</TableCell>
                    <TableCell className="text-right">{money(cashier.avgTicket)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
