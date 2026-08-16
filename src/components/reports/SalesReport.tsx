import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  PaymentMix,
  ReturnsSummary,
  SalesByDay,
  SalesSummary,
  TopProduct,
} from '@/lib/api';

export interface SalesReportData {
  summary: SalesSummary;
  byDay: SalesByDay[];
  topProducts: TopProduct[];
  paymentMix: PaymentMix[];
  returns: ReturnsSummary;
}

interface SalesReportProps {
  data: SalesReportData | null;
  loading: boolean;
  error: string | null;
}

/** One place that turns a number into money, so no card rounds differently. */
export function money(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Chart colours drawn from the design tokens rather than hard-coded hexes, so a
 * store's brand colour carries into its charts and both themes stay legible.
 *
 * Note these are `var(--st-*)`, not `hsl(var(--primary))`: the tokens are hex
 * values, so wrapping them in `hsl()` produces an invalid colour that silently
 * falls back to the library default.
 */
const CHART_FILL = 'var(--st-primary)';
const GRID_STROKE = 'var(--st-border)';
const AXIS_STROKE = 'var(--st-muted)';

interface TileProps {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}

function Tile({ label, value, hint, emphasis }: TileProps) {
  return (
    <Card className={emphasis ? 'border-primary/40' : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={emphasis ? 'text-3xl font-bold' : 'text-2xl font-semibold'}>{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading report</span>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

/**
 * The figures for a period, as the server computed them.
 *
 * Every number on this screen comes from one set of report calls for one range.
 * Nothing here re-derives a total from a list of orders — that is what made the
 * old version disagree with the receipts screen about the same day's takings.
 */
export default function SalesReport({ data, loading, error }: SalesReportProps) {
  if (loading) return <LoadingState />;

  if (error) {
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>The report could not be loaded</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">{error}</CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { summary, byDay, topProducts, paymentMix, returns } = data;
  const tendered = paymentMix.reduce((sum, row) => sum + row.amount, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile
          label="Net sales"
          value={money(summary.net)}
          hint={`${summary.orderCount} ${summary.orderCount === 1 ? 'order' : 'orders'}`}
          emphasis
        />
        <Tile label="Gross" value={money(summary.gross)} hint="before discounts and tax" />
        <Tile label="Discounts" value={money(summary.discounts)} />
        <Tile label="Tax collected" value={money(summary.tax)} />
        <Tile label="Average ticket" value={money(summary.avgTicket)} />
        <Tile
          label="Refunds"
          value={money(summary.refunds)}
          hint={
            summary.pendingRefunds > 0
              ? `${money(summary.pendingRefunds)} pending approval`
              : 'completed returns'
          }
        />
        <Tile
          label="Kept after refunds"
          value={money(summary.netAfterRefunds)}
          hint="net less completed refunds"
        />
        <Tile
          label="Returns"
          value={String(returns.returnCount)}
          hint={returns.pendingCount > 0 ? `${returns.pendingCount} awaiting approval` : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sales by day</CardTitle>
        </CardHeader>
        <CardContent>
          {byDay.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No sales were recorded in this period
            </p>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byDay} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="date" stroke={AXIS_STROKE} fontSize={12} tickMargin={8} />
                  <YAxis
                    stroke={AXIS_STROKE}
                    fontSize={12}
                    width={72}
                    tickFormatter={(value: number) => money(value)}
                  />
                  <Tooltip
                    formatter={(value: number) => money(value)}
                    contentStyle={{
                      background: 'var(--st-surface)',
                      border: `1px solid ${GRID_STROKE}`,
                      borderRadius: 'var(--st-radius-md)',
                      color: 'var(--st-fg)',
                    }}
                  />
                  <Bar dataKey="net" name="Net sales" fill={CHART_FILL} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top products</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      No sales data for this period
                    </TableCell>
                  </TableRow>
                ) : (
                  topProducts.map((item) => (
                    <TableRow key={item.productId}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {money(item.revenue)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How it was paid</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentMix.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      Nothing was tendered in this period
                    </TableCell>
                  </TableRow>
                ) : (
                  paymentMix.map((row) => (
                    <TableRow key={row.method}>
                      <TableCell className="font-medium capitalize">
                        {row.method.replace('_', ' ')}
                      </TableCell>
                      <TableCell className="text-right">{row.count}</TableCell>
                      <TableCell className="text-right font-semibold">{money(row.amount)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {tendered === 0 ? '—' : `${Math.round((row.amount / tendered) * 100)}%`}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {returns.byReason.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Why things came back</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Returns</TableHead>
                  <TableHead className="text-right">Refunded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {returns.byReason.map((row) => (
                  <TableRow key={row.reasonCode}>
                    <TableCell className="font-medium capitalize">
                      {row.reasonCode.replace('_', ' ')}
                    </TableCell>
                    <TableCell className="text-right">{row.returnCount}</TableCell>
                    <TableCell className="text-right font-semibold">{money(row.refunded)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
