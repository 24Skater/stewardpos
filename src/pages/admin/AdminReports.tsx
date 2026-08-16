import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { quotesApi } from '@/lib/api';
import { DollarSign, ShoppingCart, Briefcase, FileText } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import ReportRangePicker from '@/components/ReportRangePicker';
import SalesReport, { money } from '@/components/reports/SalesReport';
import { useSalesReport } from '@/hooks/queries';
import { describeRange, periodRange, type ReportPeriod } from '@/lib/report-range';
import { getErrorMessage } from '@/lib/errors';

interface Quote {
  id: string;
  createdAt: number;
  status: string;
  total: number;
  taxTotal: number;
  customerName?: string;
  items: { description: string; quantity: number; lineTotal: number }[];
}

export default function AdminReports() {
  const [period, setPeriod] = useState<ReportPeriod>('today');
  const [range, setRange] = useState(() => periodRange('today'));

  /**
   * Product sales come from the reporting API — summed by the database over the
   * whole period, rather than by downloading every order and adding them up
   * here, which is what this screen used to do.
   */
  const { data, isLoading, error } = useSalesReport(range);

  const [serviceStats, setServiceStats] = useState({
    grossRevenue: 0,
    quoteCount: 0,
    completedCount: 0,
    avgQuoteValue: 0,
  });
  const [topServices, setTopServices] = useState<{ name: string; qty: number; gross: number }[]>([]);
  const [recentQuotes, setRecentQuotes] = useState<Quote[]>([]);

  /**
   * Services still aggregate client-side.
   *
   * Quotes have no reporting endpoint: the Services & Quotes module is deferred
   * backlog (D2), so building SQL aggregates for it would be building out scope
   * this version has decided not to ship. The tab is left as it was rather than
   * half-migrated.
   */
  const rangeBounds = useMemo(() => {
    const from = range.from ? Date.parse(`${range.from}T00:00:00.000Z`) : 0;
    const to = range.to ? Date.parse(`${range.to}T23:59:59.999Z`) : Date.now();
    return { from, to };
  }, [range.from, range.to]);

  useEffect(() => {
    const loadServices = async () => {
      try {
        const quotes = (await quotesApi.list()) ?? [];
        const inRange = quotes.filter(
          (q) => q.createdAt >= rangeBounds.from && q.createdAt <= rangeBounds.to
        );
        const completed = inRange.filter((q) => q.status === 'completed');

        setServiceStats({
          grossRevenue: completed.reduce((sum, q) => sum + q.total, 0),
          quoteCount: inRange.length,
          completedCount: completed.length,
          avgQuoteValue:
            inRange.length > 0
              ? inRange.reduce((sum, q) => sum + q.total, 0) / inRange.length
              : 0,
        });

        const serviceMap = new Map<string, { name: string; qty: number; gross: number }>();
        completed.forEach((quote) => {
          quote.items?.forEach((item) => {
            const existing = serviceMap.get(item.description) || {
              name: item.description,
              qty: 0,
              gross: 0,
            };
            existing.qty += item.quantity;
            existing.gross += item.lineTotal;
            serviceMap.set(item.description, existing);
          });
        });
        setTopServices(
          Array.from(serviceMap.values()).sort((a, b) => b.gross - a.gross).slice(0, 10)
        );
        setRecentQuotes(quotes.slice(0, 10));
      } catch {
        // A quotes failure must not blank the sales tab, which is the reason
        // most people open this screen.
        setServiceStats({ grossRevenue: 0, quoteCount: 0, completedCount: 0, avgQuoteValue: 0 });
        setTopServices([]);
        setRecentQuotes([]);
      }
    };

    void loadServices();
  }, [rangeBounds]);

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      draft: 'outline',
      sent: 'secondary',
      accepted: 'default',
      completed: 'default',
      rejected: 'destructive',
      cancelled: 'destructive',
    };
    return <Badge variant={variants[status] || 'outline'}>{status}</Badge>;
  };

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Reports</h1>
              <p className="text-muted-foreground">{describeRange(range)}</p>
            </div>
            <ReportRangePicker
              period={period}
              range={range}
              onChange={(nextPeriod, nextRange) => {
                setPeriod(nextPeriod);
                setRange(nextRange);
              }}
            />
          </div>

          <Tabs defaultValue="sales" className="space-y-6">
            <TabsList>
              <TabsTrigger value="sales" className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" />
                Product Sales
              </TabsTrigger>
              <TabsTrigger value="services" className="flex items-center gap-2">
                <Briefcase className="w-4 h-4" />
                Services
              </TabsTrigger>
            </TabsList>

            {/* Product Sales Tab */}
            <TabsContent value="sales" className="space-y-6">
              <SalesReport
                data={data ?? null}
                loading={isLoading}
                error={error ? getErrorMessage(error, 'The report could not be loaded') : null}
              />
            </TabsContent>

            {/* Services Tab */}
            <TabsContent value="services" className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Completed Revenue</CardTitle>
                    <DollarSign className="w-4 h-4 text-green-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{money(serviceStats.grossRevenue)}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Total Quotes</CardTitle>
                    <FileText className="w-4 h-4 text-blue-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{serviceStats.quoteCount}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Completed</CardTitle>
                    <Briefcase className="w-4 h-4 text-purple-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{serviceStats.completedCount}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Avg Quote Value</CardTitle>
                    <DollarSign className="w-4 h-4 text-orange-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{money(serviceStats.avgQuoteValue)}</div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Top Services</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Service</TableHead>
                          <TableHead>Qty</TableHead>
                          <TableHead>Revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topServices.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                              No completed quotes for this period
                            </TableCell>
                          </TableRow>
                        ) : (
                          topServices.map((item, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="font-medium">{item.name}</TableCell>
                              <TableCell>{item.qty}</TableCell>
                              <TableCell>{money(item.gross)}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Recent Quotes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Customer</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recentQuotes.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                              No quotes yet
                            </TableCell>
                          </TableRow>
                        ) : (
                          recentQuotes.map((quote) => (
                            <TableRow key={quote.id}>
                              <TableCell className="font-medium">{quote.customerName || '—'}</TableCell>
                              <TableCell>{getStatusBadge(quote.status)}</TableCell>
                              <TableCell>{money(quote.total)}</TableCell>
                              <TableCell>{new Date(quote.createdAt).toLocaleDateString()}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
