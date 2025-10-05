import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getAllOrders, getAllProducts } from '@/lib/db';
import { DollarSign, ShoppingCart, Package, AlertTriangle } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';

export default function Dashboard() {
  const [stats, setStats] = useState({
    todaySales: 0,
    todayOrders: 0,
    lowStock: 0,
    totalProducts: 0,
  });

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    const orders = await getAllOrders();
    const products = await getAllProducts();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    const todayOrders = orders.filter(o => o.createdAt >= todayTimestamp);
    const todaySales = todayOrders.reduce((sum, o) => sum + o.total, 0);

    const lowStock = products.reduce((count, p) => {
      const hasLowStock = p.variants.some(v => v.enabled && v.stock < 10);
      return hasLowStock ? count + 1 : count;
    }, 0);

    setStats({
      todaySales,
      todayOrders: todayOrders.length,
      lowStock,
      totalProducts: products.length,
    });
  };

  const cards = [
    {
      title: "Today's Sales",
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
      title: 'Low Stock Items',
      value: stats.lowStock.toString(),
      icon: AlertTriangle,
      color: 'text-orange-600',
    },
    {
      title: 'Total Products',
      value: stats.totalProducts.toString(),
      icon: Package,
      color: 'text-purple-600',
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
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
