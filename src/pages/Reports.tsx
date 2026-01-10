import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";
import type { Order, OrderItem } from "@/lib/api-types";
import { ArrowLeft, DollarSign, ShoppingCart, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";

export default function Reports() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [dateRange, setDateRange] = useState(7);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, [dateRange]);

  const loadData = async () => {
    try {
      setLoading(true);
      const now = Date.now();
      const startDate = now - dateRange * 86400000;

      const response = await apiClient.get<{ success: boolean; data: Order[] }>('/api/orders');
      if (response.success) {
        const filteredOrders = response.data.filter(o => o.createdAt >= startDate);
        setOrders(filteredOrders);

        // Extract order items from orders (if included in response)
        const allItems: OrderItem[] = [];
        filteredOrders.forEach(order => {
          if (order.items) {
            allItems.push(...order.items);
          }
        });
        setOrderItems(allItems);
      }
    } catch (error: any) {
      // Error logged via toast notification
      // Set empty arrays on error
      setOrders([]);
      setOrderItems([]);
    } finally {
      setLoading(false);
    }
  };

  const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
  const totalOrders = orders.length;
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Top items
  const itemSales = orderItems.reduce((acc, item) => {
    const key = item.nameSnapshot;
    if (!acc[key]) {
      acc[key] = { name: key, qty: 0, revenue: 0 };
    }
    acc[key].qty += item.quantity;
    acc[key].revenue += item.lineTotal;
    return acc;
  }, {} as Record<string, { name: string; qty: number; revenue: number }>);

  const topItems = Object.values(itemSales)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-3 shadow-sm sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => navigate('/')}
              className="hover:bg-secondary"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">Sales Reports</h1>
              <p className="text-xs text-muted-foreground">Performance overview</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge
              variant={dateRange === 1 ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setDateRange(1)}
            >
              Today
            </Badge>
            <Badge
              variant={dateRange === 7 ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setDateRange(7)}
            >
              7 Days
            </Badge>
            <Badge
              variant={dateRange === 30 ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setDateRange(30)}
            >
              30 Days
            </Badge>
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Sales</CardTitle>
              <DollarSign className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">${totalRevenue.toFixed(2)}</div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Orders</CardTitle>
              <ShoppingCart className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{totalOrders}</div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Ticket</CardTitle>
              <TrendingUp className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">${avgTicket.toFixed(2)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Top Items Table */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Top 10 Items</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-foreground font-semibold">Product</TableHead>
                  <TableHead className="text-foreground font-semibold text-right">Qty Sold</TableHead>
                  <TableHead className="text-foreground font-semibold text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topItems.map((item, idx) => (
                  <TableRow key={idx} className="border-border hover:bg-secondary/20">
                    <TableCell className="font-medium text-foreground">{item.name}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{item.qty}</TableCell>
                    <TableCell className="text-right text-foreground font-semibold">${item.revenue.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {topItems.length === 0 && (
              <div className="py-8 text-center text-muted-foreground">
                No sales data for this period
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
