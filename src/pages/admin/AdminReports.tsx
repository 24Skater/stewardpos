import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/api-client';
import { DollarSign, ShoppingCart, Briefcase, FileText } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';

interface Order {
  id: string;
  createdAt: number;
  total: number;
  taxTotal: number;
  items: { nameSnapshot: string; quantity: number; lineTotal: number }[];
}

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
  const [period, setPeriod] = useState<'today' | '7days' | '30days'>('today');
  const [salesStats, setSalesStats] = useState({
    grossSales: 0,
    orderCount: 0,
    avgTicket: 0,
    taxCollected: 0,
  });
  const [serviceStats, setServiceStats] = useState({
    grossRevenue: 0,
    quoteCount: 0,
    completedCount: 0,
    avgQuoteValue: 0,
  });
  const [topProducts, setTopProducts] = useState<{ name: string; qty: number; gross: number }[]>([]);
  const [topServices, setTopServices] = useState<{ name: string; qty: number; gross: number }[]>([]);
  const [recentQuotes, setRecentQuotes] = useState<Quote[]>([]);

  useEffect(() => {
    loadReports();
  }, [period]);

  const getStartDate = () => {
    const now = Date.now();
    switch (period) {
      case 'today':
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today.getTime();
      case '7days':
        return now - 7 * 24 * 60 * 60 * 1000;
      case '30days':
        return now - 30 * 24 * 60 * 60 * 1000;
    }
  };

  const loadReports = async () => {
    try {
      const [ordersResponse, quotesResponse] = await Promise.all([
        apiClient.get<{ success: boolean; data: Order[] }>('/api/orders'),
        apiClient.get<{ success: boolean; data: Quote[] }>('/api/quotes'),
      ]);

      const orders = ordersResponse.success ? ordersResponse.data : [];
      const quotes = quotesResponse.success ? quotesResponse.data : [];
      const startDate = getStartDate();

      // Filter by period
      const filteredOrders = orders.filter(o => o.createdAt >= startDate);
      const filteredQuotes = quotes.filter(q => q.createdAt >= startDate);

      // Sales stats
      const grossSales = filteredOrders.reduce((sum, o) => sum + o.total, 0);
      const salesTax = filteredOrders.reduce((sum, o) => sum + o.taxTotal, 0);
      const orderCount = filteredOrders.length;
      const avgTicket = orderCount > 0 ? grossSales / orderCount : 0;

      setSalesStats({
        grossSales,
        orderCount,
        avgTicket,
        taxCollected: salesTax,
      });

      // Top products
      const productMap = new Map<string, { name: string; qty: number; gross: number }>();
      filteredOrders.forEach(order => {
        order.items?.forEach(item => {
          const existing = productMap.get(item.nameSnapshot) || { name: item.nameSnapshot, qty: 0, gross: 0 };
          existing.qty += item.quantity;
          existing.gross += item.lineTotal;
          productMap.set(item.nameSnapshot, existing);
        });
      });
      setTopProducts(Array.from(productMap.values()).sort((a, b) => b.gross - a.gross).slice(0, 10));

      // Service stats
      const completedQuotes = filteredQuotes.filter(q => q.status === 'completed');
      const grossRevenue = completedQuotes.reduce((sum, q) => sum + q.total, 0);
      const quoteCount = filteredQuotes.length;
      const completedCount = completedQuotes.length;
      const avgQuoteValue = quoteCount > 0 ? filteredQuotes.reduce((sum, q) => sum + q.total, 0) / quoteCount : 0;

      setServiceStats({
        grossRevenue,
        quoteCount,
        completedCount,
        avgQuoteValue,
      });

      // Top services
      const serviceMap = new Map<string, { name: string; qty: number; gross: number }>();
      completedQuotes.forEach(quote => {
        quote.items?.forEach(item => {
          const existing = serviceMap.get(item.description) || { name: item.description, qty: 0, gross: 0 };
          existing.qty += item.quantity;
          existing.gross += item.lineTotal;
          serviceMap.set(item.description, existing);
        });
      });
      setTopServices(Array.from(serviceMap.values()).sort((a, b) => b.gross - a.gross).slice(0, 10));

      // Recent quotes
      setRecentQuotes(quotes.slice(0, 10));
    } catch (error) {
      console.error('Error loading reports:', error);
    }
  };

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
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Reports</h1>
              <p className="text-muted-foreground">Sales & service analytics</p>
            </div>
            <div className="flex gap-2">
              <Button variant={period === 'today' ? 'default' : 'outline'} onClick={() => setPeriod('today')}>
                Today
              </Button>
              <Button variant={period === '7days' ? 'default' : 'outline'} onClick={() => setPeriod('7days')}>
                Last 7 Days
              </Button>
              <Button variant={period === '30days' ? 'default' : 'outline'} onClick={() => setPeriod('30days')}>
                Last 30 Days
              </Button>
            </div>
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
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Gross Sales</CardTitle>
                    <DollarSign className="w-4 h-4 text-green-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">${salesStats.grossSales.toFixed(2)}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Orders</CardTitle>
                    <ShoppingCart className="w-4 h-4 text-blue-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{salesStats.orderCount}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Avg Ticket</CardTitle>
                    <FileText className="w-4 h-4 text-purple-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">${salesStats.avgTicket.toFixed(2)}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Tax Collected</CardTitle>
                    <DollarSign className="w-4 h-4 text-orange-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">${salesStats.taxCollected.toFixed(2)}</div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Top 10 Products</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Quantity Sold</TableHead>
                        <TableHead>Gross Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topProducts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                            No sales data for this period
                          </TableCell>
                        </TableRow>
                      ) : (
                        topProducts.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell>{item.qty}</TableCell>
                            <TableCell>${item.gross.toFixed(2)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
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
                    <div className="text-2xl font-bold">${serviceStats.grossRevenue.toFixed(2)}</div>
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
                    <div className="text-2xl font-bold">${serviceStats.avgQuoteValue.toFixed(2)}</div>
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
                              <TableCell>${item.gross.toFixed(2)}</TableCell>
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
                              <TableCell>${quote.total.toFixed(2)}</TableCell>
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
