import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiClient } from '@/lib/api-client';
import type { Order, OrderItem } from '@/lib/api-types';
import { Calendar } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';

export default function AdminReports() {
  const [period, setPeriod] = useState<'today' | '7days' | '30days'>('today');
  const [stats, setStats] = useState({
    grossSales: 0,
    orderCount: 0,
    avgTicket: 0,
    taxCollected: 0,
  });
  const [topItems, setTopItems] = useState<{ name: string; qty: number; gross: number }[]>([]);

  useEffect(() => {
    loadReports();
  }, [period]);

  const loadReports = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; data: Order[] }>('/api/orders');
      const orders = response.success ? response.data : [];
      
      // Extract order items from orders
      const orderItems: OrderItem[] = [];
      orders.forEach(order => {
        if (order.items) {
          orderItems.push(...order.items);
        }
      });

    const now = Date.now();
    let startDate = now;
    
    switch (period) {
      case 'today':
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        startDate = today.getTime();
        break;
      case '7days':
        startDate = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case '30days':
        startDate = now - 30 * 24 * 60 * 60 * 1000;
        break;
    }

      const filteredOrders = orders.filter(o => o.createdAt >= startDate);
      const filteredOrderIds = new Set(filteredOrders.map(o => o.id));
      const filteredItems = orderItems.filter(item => filteredOrderIds.has(item.orderId));

      const grossSales = filteredOrders.reduce((sum, o) => sum + o.total, 0);
      const taxCollected = filteredOrders.reduce((sum, o) => sum + o.taxTotal, 0);
      const orderCount = filteredOrders.length;
      const avgTicket = orderCount > 0 ? grossSales / orderCount : 0;

      // Top items
      const itemMap = new Map<string, { name: string; qty: number; gross: number }>();
      filteredItems.forEach(item => {
        const existing = itemMap.get(item.nameSnapshot) || { name: item.nameSnapshot, qty: 0, gross: 0 };
        existing.qty += item.quantity;
        existing.gross += item.lineTotal;
        itemMap.set(item.nameSnapshot, existing);
      });

      const topItemsArray = Array.from(itemMap.values())
        .sort((a, b) => b.gross - a.gross)
        .slice(0, 10);

      setStats({ grossSales, orderCount, avgTicket, taxCollected });
      setTopItems(topItemsArray);
    } catch (error) {
      console.error('Failed to load reports:', error);
    }
  };

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Reports</h1>
              <p className="text-muted-foreground">Sales analytics and insights</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant={period === 'today' ? 'default' : 'outline'}
                onClick={() => setPeriod('today')}
              >
                Today
              </Button>
              <Button
                variant={period === '7days' ? 'default' : 'outline'}
                onClick={() => setPeriod('7days')}
              >
                Last 7 Days
              </Button>
              <Button
                variant={period === '30days' ? 'default' : 'outline'}
                onClick={() => setPeriod('30days')}
              >
                Last 30 Days
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">Gross Sales</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${stats.grossSales.toFixed(2)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">Orders</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.orderCount}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">Avg Ticket</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${stats.avgTicket.toFixed(2)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">Tax Collected</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${stats.taxCollected.toFixed(2)}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Top 10 Items</CardTitle>
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
                  {topItems.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{item.qty}</TableCell>
                      <TableCell>${item.gross.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
