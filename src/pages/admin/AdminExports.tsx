import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, FileText, Table } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { apiClient } from '@/lib/api-client';
import type { Order, OrderItem, Product } from '@/lib/api-types';
import { exportToCSV, exportOrdersToPDF, exportInventoryToCSV } from '@/lib/export-utils';
import { useToast } from '@/hooks/use-toast';

export default function AdminExports() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const { toast } = useToast();

  const handleExportOrdersCSV = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; data: Order[] }>('/api/orders');
      const orders = response.success ? response.data : [];
      const filteredOrders = filterByDateRange(orders);
    
    const data = filteredOrders.map(order => ({
      'Order ID': order.id,
      'Date': new Date(order.createdAt).toLocaleString(),
      'Subtotal': order.subtotal,
      'Tax': order.taxTotal,
      'Total': order.total,
      'Payment Method': order.paymentMethod,
      'Customer Email': order.customerEmail || '',
      'Customer Phone': order.customerPhone || '',
    }));

      exportToCSV(data, `orders-${new Date().toISOString().split('T')[0]}.csv`);
      toast({ title: 'Orders exported to CSV' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to export orders',
        variant: 'destructive',
      });
    }
  };

  const handleExportOrdersPDF = async () => {
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
      
      const filteredOrders = filterByDateRange(orders);
      const start = startDate ? new Date(startDate).getTime() : 0;
      const end = endDate ? new Date(endDate).getTime() : Date.now();

      // TODO: Get settings from API when available
      const settings = null; // await getSettings();
      if (settings) {
        exportOrdersToPDF(filteredOrders, orderItems, settings, { start, end });
        toast({ title: 'Orders exported to PDF' });
      } else {
        // Export without settings for now
        exportOrdersToPDF(filteredOrders, orderItems, {} as any, { start, end });
        toast({ title: 'Orders exported to PDF' });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to export orders',
        variant: 'destructive',
      });
    }
  };

  const handleExportInventory = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; data: Product[] }>('/api/products');
      if (response.success) {
        exportInventoryToCSV(response.data);
        toast({ title: 'Inventory exported to CSV' });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to export inventory',
        variant: 'destructive',
      });
    }
  };

  const filterByDateRange = <T extends { createdAt: number }>(items: T[]) => {
    let filtered = items;
    
    if (startDate) {
      const start = new Date(startDate).getTime();
      filtered = filtered.filter(item => item.createdAt >= start);
    }
    
    if (endDate) {
      const end = new Date(endDate).getTime();
      filtered = filtered.filter(item => item.createdAt <= end);
    }
    
    return filtered;
  };

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Exports</h1>
            <p className="text-muted-foreground">Download your data in various formats</p>
          </div>

          <div className="grid gap-6 mb-8">
            <Card>
              <CardHeader>
                <CardTitle>Date Range Filter</CardTitle>
                <CardDescription>Select a date range for order exports</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="startDate">Start Date</Label>
                    <Input
                      id="startDate"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="endDate">End Date</Label>
                    <Input
                      id="endDate"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Orders Export</CardTitle>
                <CardDescription>Export order data with applied date filters</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-4">
                <Button onClick={handleExportOrdersCSV}>
                  <Table className="w-4 h-4 mr-2" />
                  Export CSV
                </Button>
                <Button onClick={handleExportOrdersPDF}>
                  <FileText className="w-4 h-4 mr-2" />
                  Export PDF
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Inventory Export</CardTitle>
                <CardDescription>Export complete inventory with variants</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={handleExportInventory}>
                  <Download className="w-4 h-4 mr-2" />
                  Export Inventory CSV
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
