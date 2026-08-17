import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { customersApi, discountsApi, productsApi, quotesApi, registersApi, reportsApi, servicesApi } from '@/lib/api';
import type { Customer } from '@/lib/api';
import { DollarSign, ShoppingCart, Package, AlertTriangle, Briefcase, FileText, Users, Tag, Store } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { periodRange, toDateInput } from '@/lib/report-range';

interface Quote {
  id: string;
  createdAt: number;
  status: string;
  total: number;
  customerName?: string;
}

export default function Dashboard() {
  const [stats, setStats] = useState({
    todaySales: 0,
    todayOrders: 0,
    lowStock: 0,
    totalProducts: 0,
    todayServiceRevenue: 0,
    pendingQuotes: 0,
    totalServices: 0,
    totalCustomers: 0,
    totalDiscountAmount: 0,
    totalDiscountCount: 0,
    activeRegisters: 0,
    totalRegisters: 0,
  });
  const [salesData, setSalesData] = useState<{ date: string; sales: number; orders: number; services: number }[]>([]);
  const [recentQuotes, setRecentQuotes] = useState<Quote[]>([]);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      // Today's takings and the weekly series come from the reporting API,
      // summed by the database. This screen used to download every order the
      // shop had ever taken to work out two tiles and a chart.
      const week = periodRange('7days');
      const today = periodRange('today');

      const [
        todaySummary,
        weekByDay,
        productsResponse,
        quotesResponse,
        servicesResponse,
        customersResponse,
        discountStatsResponse,
        lowStockResponse,
        registersResponse,
      ] = await Promise.all([
        reportsApi.salesSummary(today),
        reportsApi.salesByDay(week),
        productsApi.list(),
        quotesApi.list(),
        servicesApi.list(),
        customersApi.list(),
        discountsApi.stats(),
        productsApi.lowStock(),
        registersApi.list(),
      ]);

      const discountStats = discountStatsResponse ? discountStatsResponse : { totalDiscounts: 0, totalDiscountAmount: 0 };

      const products = productsResponse ? productsResponse : [];
      const quotes = quotesResponse ? quotesResponse : [];
      const services = servicesResponse ? servicesResponse : [];
      const customers = customersResponse ? customersResponse : [];
      const lowStockItems = lowStockResponse ? lowStockResponse : [];
      const registers = registersResponse ? registersResponse : [];

      // The same instant the sales tiles were asked about, so "today" means one
      // thing on this screen rather than two.
      const todayTimestamp = Date.parse(`${today.from}T00:00:00.000Z`);

      // Low stock, counted by product rather than by variant, so a shirt that is
      // low in three sizes reads as one thing to reorder.
      //
      // This used to apply its own `stock < 10` rule to the loaded catalog. The
      // threshold is a store setting and can be overridden per variant, so the
      // server is the only thing that knows it; deciding here meant this tile
      // and the inventory screen could disagree.
      const lowStock = new Set(lowStockItems.map(item => item.productId)).size;

      // Service stats
      const todayQuotes = quotes.filter(q => q.createdAt >= todayTimestamp && q.status === 'completed');
      const todayServiceRevenue = todayQuotes.reduce((sum, q) => sum + q.total, 0);
      const pendingQuotes = quotes.filter(q => ['draft', 'sent', 'accepted'].includes(q.status)).length;

      setStats({
        todaySales: todaySummary.net,
        todayOrders: todaySummary.orderCount,
        lowStock,
        totalProducts: products.length,
        todayServiceRevenue,
        pendingQuotes,
        totalServices: services.filter(s => s.isActive).length,
        totalCustomers: customers.length,
        totalDiscountAmount: discountStats.totalDiscountAmount || 0,
        totalDiscountCount: discountStats.totalDiscounts || 0,
        activeRegisters: registers.filter((r) => r.status === 'active').length,
        totalRegisters: registers.length,
      });

      // Recent quotes
      setRecentQuotes(quotes.slice(0, 5));

      // Sales come from `sales-by-day`; service revenue is still derived from
      // the quotes list, which has no reporting endpoint because Services &
      // Quotes is deferred scope (D2).
      //
      // Every day in the week is emitted, not only the days the server returned
      // rows for. A grouped query has nothing to say about a day with no sales,
      // and a chart that simply omits those days draws a flat line through a
      // closed Sunday instead of showing the shop was shut.
      const salesForDay = new Map(weekByDay.map((day) => [day.date, day]));

      const chartData = [];
      for (let i = 6; i >= 0; i--) {
        const dayStart = Date.parse(`${toDateInput(Date.now() - i * 86400000)}T00:00:00.000Z`);
        const key = toDateInput(dayStart);
        const day = salesForDay.get(key);

        const dayQuotes = quotes.filter(
          (q) =>
            q.createdAt >= dayStart &&
            q.createdAt < dayStart + 86400000 &&
            q.status === 'completed'
        );

        chartData.push({
          date: new Date(dayStart).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
          }),
          sales: day?.net ?? 0,
          orders: day?.orderCount ?? 0,
          services: parseFloat(dayQuotes.reduce((sum, q) => sum + q.total, 0).toFixed(2)),
        });
      }

      setSalesData(chartData);
    } catch (error) {
      console.error('Error loading dashboard stats:', error);
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
    return <Badge variant={variants[status] || 'outline'} className="text-xs">{status}</Badge>;
  };

  const cards = [
    {
      title: "Today's POS Sales",
      value: `$${stats.todaySales.toFixed(2)}`,
      icon: DollarSign,
      color: 'text-green-600',
    },
    {
      title: "Today's Orders",
      value: stats.todayOrders.toString(),
      icon: ShoppingCart,
      color: 'text-blue-600',
    },
    {
      title: "Today's Service Revenue",
      value: `$${stats.todayServiceRevenue.toFixed(2)}`,
      icon: Briefcase,
      color: 'text-purple-600',
    },
    {
      title: 'Pending Quotes',
      value: stats.pendingQuotes.toString(),
      icon: FileText,
      color: 'text-amber-600',
    },
    {
      title: 'Low Stock Items',
      value: stats.lowStock.toString(),
      icon: AlertTriangle,
      color: 'text-orange-600',
    },
    {
      title: 'Total Products',
      value: stats.totalProducts.toString(),
      icon: Package,
      color: 'text-cyan-600',
    },
    {
      title: 'Active Services',
      value: stats.totalServices.toString(),
      icon: Briefcase,
      color: 'text-indigo-600',
    },
    {
      title: 'Total Customers',
      value: stats.totalCustomers.toString(),
      icon: Users,
      color: 'text-pink-600',
    },
    {
      title: 'Discounts Given',
      value: `$${stats.totalDiscountAmount.toFixed(2)}`,
      subValue: `${stats.totalDiscountCount} uses`,
      icon: Tag,
      color: 'text-rose-600',
    },
    {
      title: 'Active Registers',
      value: stats.activeRegisters.toString(),
      subValue: `${stats.totalRegisters} total`,
      icon: Store,
      color: 'text-teal-600',
    },
  ];

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground">Overview of your store performance</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <Card key={card.title}>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {card.title}
                    </CardTitle>
                    <Icon className={`w-4 h-4 ${card.color}`} />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{card.value}</div>
                    {card.subValue && (
                      <p className="text-xs text-muted-foreground mt-1">{card.subValue}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
            {/* Combined Revenue Chart */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Revenue Trend (Last 7 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={salesData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis 
                      dataKey="date" 
                      className="text-xs"
                      tick={{ fill: 'var(--st-muted)' }}
                    />
                    <YAxis 
                      className="text-xs"
                      tick={{ fill: 'var(--st-muted)' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'var(--st-surface)',
                        border: '1px solid var(--st-border)',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="sales" 
                      stroke="var(--st-primary)" 
                      strokeWidth={2}
                      name="POS Sales ($)"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="services" 
                      stroke="var(--st-link)" 
                      strokeWidth={2}
                      name="Service Revenue ($)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Recent Quotes */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Quotes</CardTitle>
              </CardHeader>
              <CardContent>
                {recentQuotes.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No quotes yet</p>
                ) : (
                  <div className="space-y-4">
                    {recentQuotes.map((quote) => (
                      <div key={quote.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <p className="font-medium text-sm">{quote.customerName || 'Walk-in'}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(quote.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-sm">${quote.total.toFixed(2)}</p>
                          {getStatusBadge(quote.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Orders Chart */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Orders (Last 7 Days)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={salesData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis 
                    dataKey="date" 
                    className="text-xs"
                    tick={{ fill: 'var(--st-muted)' }}
                  />
                  <YAxis 
                    className="text-xs"
                    tick={{ fill: 'var(--st-muted)' }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'var(--st-surface)',
                      border: '1px solid var(--st-border)',
                      borderRadius: '8px'
                    }}
                  />
                  <Legend />
                  <Bar 
                    dataKey="orders" 
                    fill="var(--st-primary)"
                    name="POS Orders"
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
