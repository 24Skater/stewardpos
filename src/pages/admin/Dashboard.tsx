import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/api-client';
import { DollarSign, ShoppingCart, Package, AlertTriangle, Briefcase, FileText, Users, Tag } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface Order {
  id: string;
  createdAt: number;
  total: number;
}

interface Product {
  id: string;
  variants: { enabled: boolean; stock: number }[];
}

interface Quote {
  id: string;
  createdAt: number;
  status: string;
  total: number;
  customerName?: string;
}

interface Service {
  id: string;
  name: string;
  isActive: boolean;
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
  });
  const [salesData, setSalesData] = useState<{ date: string; sales: number; orders: number; services: number }[]>([]);
  const [recentQuotes, setRecentQuotes] = useState<Quote[]>([]);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [ordersResponse, productsResponse, quotesResponse, servicesResponse, customersResponse, discountStatsResponse] = await Promise.all([
        apiClient.get<{ success: boolean; data: Order[] }>('/api/orders'),
        apiClient.get<{ success: boolean; data: Product[] }>('/api/products'),
        apiClient.get<{ success: boolean; data: Quote[] }>('/api/quotes'),
        apiClient.get<{ success: boolean; data: Service[] }>('/api/services'),
        apiClient.get<{ success: boolean; data: any[] }>('/api/customers'),
        apiClient.get<{ success: boolean; data: any }>('/api/discounts/stats'),
      ]);

      const discountStats = discountStatsResponse.success ? discountStatsResponse.data : { totalDiscounts: 0, totalDiscountAmount: 0 };

      const orders = ordersResponse.success ? ordersResponse.data : [];
      const products = productsResponse.success ? productsResponse.data : [];
      const quotes = quotesResponse.success ? quotesResponse.data : [];
      const services = servicesResponse.success ? servicesResponse.data : [];
      const customers = customersResponse.success ? customersResponse.data : [];

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTimestamp = today.getTime();

      // POS Sales stats
      const todayOrders = orders.filter(o => o.createdAt >= todayTimestamp);
      const todaySales = todayOrders.reduce((sum, o) => sum + o.total, 0);

      // Low stock
      const lowStock = products.reduce((count, p) => {
        const hasLowStock = p.variants?.some(v => v.enabled && v.stock < 10);
        return hasLowStock ? count + 1 : count;
      }, 0);

      // Service stats
      const todayQuotes = quotes.filter(q => q.createdAt >= todayTimestamp && q.status === 'completed');
      const todayServiceRevenue = todayQuotes.reduce((sum, q) => sum + q.total, 0);
      const pendingQuotes = quotes.filter(q => ['draft', 'sent', 'accepted'].includes(q.status)).length;

      setStats({
        todaySales,
        todayOrders: todayOrders.length,
        lowStock,
        totalProducts: products.length,
        todayServiceRevenue,
        pendingQuotes,
        totalServices: services.filter(s => s.isActive).length,
        totalCustomers: customers.length,
        totalDiscountAmount: discountStats.totalDiscountAmount || 0,
        totalDiscountCount: discountStats.totalDiscounts || 0,
      });

      // Recent quotes
      setRecentQuotes(quotes.slice(0, 5));

      // Generate last 7 days data for charts
      const chartData = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        
        const dayStart = date.getTime();
        const dayEnd = dayStart + 24 * 60 * 60 * 1000;
        
        const dayOrders = orders.filter(o => o.createdAt >= dayStart && o.createdAt < dayEnd);
        const daySales = dayOrders.reduce((sum, o) => sum + o.total, 0);
        
        const dayQuotes = quotes.filter(q => q.createdAt >= dayStart && q.createdAt < dayEnd && q.status === 'completed');
        const dayServices = dayQuotes.reduce((sum, q) => sum + q.total, 0);
        
        chartData.push({
          date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          sales: parseFloat(daySales.toFixed(2)),
          orders: dayOrders.length,
          services: parseFloat(dayServices.toFixed(2)),
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
                      tick={{ fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="sales" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      name="POS Sales ($)"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="services" 
                      stroke="#8b5cf6" 
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
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Legend />
                  <Bar 
                    dataKey="orders" 
                    fill="hsl(var(--primary))"
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
