import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { 
  Download, 
  FileText, 
  Table as TableIcon, 
  Calendar,
  TrendingUp,
  Users,
  ShoppingCart,
  Briefcase,
  FileSpreadsheet,
  BarChart3
} from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { apiClient } from '@/lib/api-client';
import { 
  exportToCSV,
  exportToExcel,
  exportInventoryToCSV,
  generateSalesMoMReport,
  generateSalesWoWReport,
  generateSalesByCustomerReport,
  generateSalesByItemReport,
  generateTrendingReport,
  generateCustomerListReport,
  generateCustomerOrderHistoryReport,
  generateServicesByTypeReport,
  generateServicesByCategoryReport,
  exportSalesMoMToPDF,
  exportSalesWoWToPDF,
  exportSalesByCustomerToPDF,
  exportSalesByItemToPDF,
  exportTrendingToPDF,
  exportCustomerListToPDF,
  exportServicesToPDF,
} from '@/lib/export-utils';
import { useToast } from '@/hooks/use-toast';

interface Order {
  id: string;
  createdAt: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paymentMethod: string;
  customerEmail?: string;
  customerPhone?: string;
  items?: any[];
}

interface Quote {
  id: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  status: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  createdAt: number;
  items?: any[];
}

interface Customer {
  id: string;
  name: string;
  org?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  createdAt: number;
}

interface Service {
  id: string;
  name: string;
  category: string;
  description?: string;
  basePrice?: number;
  unitType?: string;
  isActive: boolean;
}

export default function AdminExports() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [loading, setLoading] = useState<string | null>(null);
  
  // Data
  const [orders, setOrders] = useState<Order[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  
  const { toast } = useToast();

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    try {
      const [ordersRes, quotesRes, customersRes, servicesRes, productsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Order[] }>('/api/orders'),
        apiClient.get<{ success: boolean; data: Quote[] }>('/api/quotes'),
        apiClient.get<{ success: boolean; data: Customer[] }>('/api/customers'),
        apiClient.get<{ success: boolean; data: Service[] }>('/api/services'),
        apiClient.get<{ success: boolean; data: any[] }>('/api/products'),
      ]);

      if (ordersRes.success) setOrders(ordersRes.data);
      if (quotesRes.success) setQuotes(quotesRes.data);
      if (customersRes.success) setCustomers(customersRes.data);
      if (servicesRes.success) setServices(servicesRes.data);
      if (productsRes.success) setProducts(productsRes.data);
    } catch (error: any) {
      toast({
        title: 'Error loading data',
        description: error.message,
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
      const end = new Date(endDate).setHours(23, 59, 59, 999);
      filtered = filtered.filter(item => item.createdAt <= end);
    }
    return filtered;
  };

  const handleExport = async (reportType: string, format: 'pdf' | 'excel' | 'csv') => {
    setLoading(reportType);
    
    try {
      const filteredOrders = filterByDateRange(orders);
      const filteredQuotes = filterByDateRange(quotes);
      
      switch (reportType) {
        case 'sales-mom': {
          const data = generateSalesMoMReport(filteredOrders);
          if (format === 'pdf') {
            exportSalesMoMToPDF(data);
          } else if (format === 'excel') {
            exportToExcel([{ name: 'Month over Month', data }], 'sales-mom.xlsx');
          } else {
            exportToCSV(data, 'sales-mom.csv');
          }
          break;
        }
        
        case 'sales-wow': {
          const data = generateSalesWoWReport(filteredOrders);
          if (format === 'pdf') {
            exportSalesWoWToPDF(data);
          } else if (format === 'excel') {
            exportToExcel([{ name: 'Week over Week', data }], 'sales-wow.xlsx');
          } else {
            exportToCSV(data, 'sales-wow.csv');
          }
          break;
        }
        
        case 'sales-customer': {
          const data = generateSalesByCustomerReport(filteredOrders, customers);
          if (format === 'pdf') {
            exportSalesByCustomerToPDF(data);
          } else if (format === 'excel') {
            exportToExcel([{ name: 'Sales by Customer', data }], 'sales-by-customer.xlsx');
          } else {
            exportToCSV(data, 'sales-by-customer.csv');
          }
          break;
        }
        
        case 'sales-item': {
          const data = generateSalesByItemReport(filteredOrders);
          if (format === 'pdf') {
            exportSalesByItemToPDF(data);
          } else if (format === 'excel') {
            exportToExcel([{ name: 'Sales by Item', data }], 'sales-by-item.xlsx');
          } else {
            exportToCSV(data, 'sales-by-item.csv');
          }
          break;
        }
        
        case 'trending': {
          const { productTrends, serviceTrends } = generateTrendingReport(filteredOrders, filteredQuotes);
          if (format === 'pdf') {
            exportTrendingToPDF(productTrends, serviceTrends);
          } else if (format === 'excel') {
            exportToExcel([
              { name: 'Product Trends', data: productTrends },
              { name: 'Service Trends', data: serviceTrends },
            ], 'trending-report.xlsx');
          } else {
            exportToCSV(productTrends, 'product-trends.csv');
            exportToCSV(serviceTrends, 'service-trends.csv');
          }
          break;
        }
        
        case 'customer-list': {
          const data = generateCustomerListReport(customers);
          if (format === 'pdf') {
            exportCustomerListToPDF(data);
          } else if (format === 'excel') {
            exportToExcel([{ name: 'Customers', data }], 'customers.xlsx');
          } else {
            exportToCSV(data, 'customers.csv');
          }
          break;
        }
        
        case 'customer-history': {
          if (!selectedCustomer) {
            toast({ title: 'Please select a customer', variant: 'destructive' });
            setLoading(null);
            return;
          }
          const customer = customers.find(c => c.id === selectedCustomer);
          if (!customer) {
            setLoading(null);
            return;
          }
          const customerOrders = orders.filter(o => o.customerEmail === customer.email);
          const customerQuotes = quotes.filter(q => q.customerId === customer.id);
          const { customer: customerInfo, transactions } = generateCustomerOrderHistoryReport(
            customer, customerOrders, customerQuotes
          );
          
          if (format === 'excel') {
            exportToExcel([
              { name: 'Customer Info', data: [customerInfo] },
              { name: 'Transactions', data: transactions },
            ], `customer-${customer.name.replace(/\s+/g, '-')}.xlsx`);
          } else {
            exportToCSV(transactions, `customer-history-${customer.name.replace(/\s+/g, '-')}.csv`);
          }
          break;
        }
        
        case 'customer-history-all': {
          const allHistories: any[] = [];
          customers.forEach(customer => {
            const customerOrders = orders.filter(o => o.customerEmail === customer.email);
            const customerQuotes = quotes.filter(q => q.customerId === customer.id);
            const { transactions } = generateCustomerOrderHistoryReport(customer, customerOrders, customerQuotes);
            transactions.forEach(t => allHistories.push({ ...t, 'Customer': customer.name }));
          });
          
          if (format === 'excel') {
            exportToExcel([{ name: 'All Customer History', data: allHistories }], 'all-customer-history.xlsx');
          } else {
            exportToCSV(allHistories, 'all-customer-history.csv');
          }
          break;
        }
        
        case 'services-type': {
          const data = generateServicesByTypeReport(services);
          if (format === 'pdf') {
            exportServicesToPDF(data);
          } else if (format === 'excel') {
            exportToExcel([{ name: 'Services', data }], 'services.xlsx');
          } else {
            exportToCSV(data, 'services.csv');
          }
          break;
        }
        
        case 'services-category': {
          const data = generateServicesByCategoryReport(services, quotes);
          if (format === 'excel') {
            exportToExcel([{ name: 'Services by Category', data }], 'services-by-category.xlsx');
          } else {
            exportToCSV(data, 'services-by-category.csv');
          }
          break;
        }
        
        case 'inventory': {
          if (format === 'excel') {
            const data = products.flatMap(p => 
              p.variants.map((v: any) => ({
                'Product': p.name,
                'Category': p.category,
                'Base Price': p.basePrice,
                'Size': v.size || '',
                'Color': v.color || '',
                'SKU': v.sku || '',
                'Barcode': v.barcode || '',
                'Stock': v.stock,
                'Active': v.enabled ? 'Yes' : 'No',
              }))
            );
            exportToExcel([{ name: 'Inventory', data }], 'inventory.xlsx');
          } else {
            exportInventoryToCSV(products);
          }
          break;
        }
      }
      
      toast({ title: 'Export completed successfully' });
    } catch (error: any) {
      toast({
        title: 'Export failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(null);
    }
  };

  const ExportButtons = ({ reportType, formats }: { reportType: string; formats: ('pdf' | 'excel' | 'csv')[] }) => (
    <div className="flex gap-2 flex-wrap">
      {formats.includes('pdf') && (
        <Button 
          size="sm" 
          variant="outline"
          onClick={() => handleExport(reportType, 'pdf')}
          disabled={loading === reportType}
        >
          <FileText className="w-4 h-4 mr-2" />
          PDF
        </Button>
      )}
      {formats.includes('excel') && (
        <Button 
          size="sm"
          variant="outline" 
          onClick={() => handleExport(reportType, 'excel')}
          disabled={loading === reportType}
        >
          <FileSpreadsheet className="w-4 h-4 mr-2" />
          Excel
        </Button>
      )}
      {formats.includes('csv') && (
        <Button 
          size="sm"
          variant="outline" 
          onClick={() => handleExport(reportType, 'csv')}
          disabled={loading === reportType}
        >
          <TableIcon className="w-4 h-4 mr-2" />
          CSV
        </Button>
      )}
    </div>
  );

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Reports & Exports</h1>
            <p className="text-muted-foreground">Generate and download comprehensive reports</p>
          </div>

          {/* Date Range Filter */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Date Range Filter
              </CardTitle>
              <CardDescription>Filter reports by date range (applies to all sales reports)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                <div className="col-span-2 flex items-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => {
                    const today = new Date();
                    setStartDate(new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]);
                    setEndDate(today.toISOString().split('T')[0]);
                  }}>This Month</Button>
                  <Button variant="outline" size="sm" onClick={() => {
                    const today = new Date();
                    setStartDate(new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0]);
                    setEndDate(today.toISOString().split('T')[0]);
                  }}>This Year</Button>
                  <Button variant="ghost" size="sm" onClick={() => { setStartDate(''); setEndDate(''); }}>Clear</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="sales" className="space-y-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="sales" className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" />
                Sales Reports
              </TabsTrigger>
              <TabsTrigger value="customers" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Customers
              </TabsTrigger>
              <TabsTrigger value="services" className="flex items-center gap-2">
                <Briefcase className="w-4 h-4" />
                Services
              </TabsTrigger>
              <TabsTrigger value="inventory" className="flex items-center gap-2">
                <Download className="w-4 h-4" />
                Inventory
              </TabsTrigger>
            </TabsList>

            {/* Sales Reports Tab */}
            <TabsContent value="sales" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-blue-500" />
                      Sales Month-over-Month
                    </CardTitle>
                    <CardDescription>Revenue and order trends by month</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ExportButtons reportType="sales-mom" formats={['pdf', 'excel', 'csv']} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-green-500" />
                      Sales Week-over-Week
                    </CardTitle>
                    <CardDescription>Revenue and order trends by week</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ExportButtons reportType="sales-wow" formats={['pdf', 'excel', 'csv']} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5 text-purple-500" />
                      Sales by Customer
                    </CardTitle>
                    <CardDescription>Revenue breakdown by customer</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ExportButtons reportType="sales-customer" formats={['pdf', 'excel', 'csv']} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ShoppingCart className="w-5 h-5 text-orange-500" />
                      Sales by Item
                    </CardTitle>
                    <CardDescription>Top selling products with revenue</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ExportButtons reportType="sales-item" formats={['pdf', 'excel', 'csv']} />
                  </CardContent>
                </Card>

                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-emerald-500" />
                      Trending Report
                      <Badge variant="secondary">Products & Services</Badge>
                    </CardTitle>
                    <CardDescription>
                      What's hot: Compare recent 30 days vs previous period. Shows growth/decline trends.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ExportButtons reportType="trending" formats={['pdf', 'excel', 'csv']} />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Customers Tab */}
            <TabsContent value="customers" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5 text-blue-500" />
                      Customer List
                    </CardTitle>
                    <CardDescription>Export all customers with contact information</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant="outline">{customers.length} customers</Badge>
                    </div>
                    <ExportButtons reportType="customer-list" formats={['pdf', 'excel', 'csv']} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ShoppingCart className="w-5 h-5 text-purple-500" />
                      Customer Order History
                    </CardTitle>
                    <CardDescription>POS sales and service quotes for a specific customer</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label>Select Customer</Label>
                      <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a customer..." />
                        </SelectTrigger>
                        <SelectContent>
                          {customers.map(c => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name} {c.email ? `(${c.email})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <ExportButtons reportType="customer-history" formats={['excel', 'csv']} />
                  </CardContent>
                </Card>

                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileSpreadsheet className="w-5 h-5 text-emerald-500" />
                      All Customer Histories
                      <Badge>Combined</Badge>
                    </CardTitle>
                    <CardDescription>
                      Complete order history for ALL customers (POS sales + Service quotes)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ExportButtons reportType="customer-history-all" formats={['excel', 'csv']} />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Services Tab */}
            <TabsContent value="services" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Briefcase className="w-5 h-5 text-blue-500" />
                      Services by Type
                    </CardTitle>
                    <CardDescription>All services with pricing and details</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant="outline">{services.length} services</Badge>
                      <Badge variant="outline">{services.filter(s => s.isActive).length} active</Badge>
                    </div>
                    <ExportButtons reportType="services-type" formats={['pdf', 'excel', 'csv']} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-purple-500" />
                      Services by Category
                    </CardTitle>
                    <CardDescription>Category breakdown with revenue from completed quotes</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ExportButtons reportType="services-category" formats={['excel', 'csv']} />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Inventory Tab */}
            <TabsContent value="inventory" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Download className="w-5 h-5 text-blue-500" />
                    Inventory Export
                  </CardTitle>
                  <CardDescription>Complete inventory with all product variants, SKUs, and stock levels</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="outline">{products.length} products</Badge>
                    <Badge variant="outline">
                      {products.reduce((sum, p) => sum + (p.variants?.length || 0), 0)} variants
                    </Badge>
                  </div>
                  <ExportButtons reportType="inventory" formats={['excel', 'csv']} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
