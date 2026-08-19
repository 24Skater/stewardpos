import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { money } from './SalesReport';
import { ReportLoadingState } from './ReportLoadingState';
import type { DrawerVarianceByRegister, NoSaleCount } from '@/lib/api';

export interface LossPreventionReportData {
  drawerVariance: DrawerVarianceByRegister[];
  noSales: NoSaleCount[];
}

export interface LossPreventionReportProps {
  data: LossPreventionReportData | null;
  loading: boolean;
  error: string | null;
}

/** Whether an amount closed short, over, or exact — spelled out, not left to colour. */
function varianceWord(amount: number): 'short' | 'over' | 'exact' {
  if (amount === 0) return 'exact';
  return amount < 0 ? 'short' : 'over';
}

/**
 * The two reports that catch problems: which drawers are closing short and by
 * how much, and which registers are seeing drawers opened with nothing rung
 * up — the single best theft signal a POS can report on.
 *
 * Both are first-class here rather than a footnote on the sales figures: a
 * short till and a spike in no-sales are what a manager opening this screen
 * is actually looking for. Every variance is labelled with a word
 * ("short"/"over"/"exact") alongside the amount, since colour alone is not an
 * accessible way to say a drawer came up short.
 */
export default function LossPreventionReport({ data, loading, error }: LossPreventionReportProps) {
  if (loading) return <ReportLoadingState />;

  if (error) {
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>The loss-prevention report could not be loaded</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">{error}</CardContent>
      </Card>
    );
  }

  if (!data) return null;

  // Worst overall shortfall first: that is the row a manager needs to see.
  const variance = [...data.drawerVariance].sort((a, b) => a.totalVariance - b.totalVariance);
  // Highest no-sale count first: the register most worth asking about.
  const noSales = [...data.noSales].sort((a, b) => b.noSaleCount - a.noSaleCount);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Drawer variance by register</CardTitle>
          <p className="text-sm text-muted-foreground">
            Closed drawer sessions whose counted cash did not match what was expected, worst first.
          </p>
        </CardHeader>
        <CardContent>
          {variance.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No drawer sessions closed in this period
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Register</TableHead>
                    <TableHead scope="col" className="text-right">
                      Sessions
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Short sessions
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Total variance
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Worst session
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variance.map((row) => (
                    <TableRow key={row.registerId}>
                      <TableCell className="font-medium">
                        {row.displayCode} — {row.name}
                      </TableCell>
                      <TableCell className="text-right">{row.sessionCount}</TableCell>
                      <TableCell className="text-right">
                        {row.shortCount > 0 ? (
                          <span className="font-medium text-destructive">{row.shortCount} short</span>
                        ) : (
                          '0'
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {money(row.totalVariance)}{' '}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({varianceWord(row.totalVariance)})
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.worstVariance === 0
                          ? '—'
                          : `${money(row.worstVariance)} (${varianceWord(row.worstVariance)})`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>No-sale drawer opens</CardTitle>
          <p className="text-sm text-muted-foreground">
            Drawers opened with nothing rung up — the single best theft signal a register can report,
            highest first.
          </p>
        </CardHeader>
        <CardContent>
          {noSales.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No no-sale drawer opens were recorded in this period
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Register</TableHead>
                    <TableHead scope="col" className="text-right">
                      No-sale opens
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {noSales.map((row) => (
                    <TableRow key={row.registerId}>
                      <TableCell className="font-medium">
                        {row.displayCode} — {row.name}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{row.noSaleCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
