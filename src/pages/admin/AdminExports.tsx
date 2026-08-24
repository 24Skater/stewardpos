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
  BarChart3,
  RotateCcw,
  Store,
  ShieldAlert
} from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import {
  customersApi,
  ordersApi,
  productsApi,
  quotesApi,
  reportsApi,
  returnsApi,
  servicesApi,
} from '@/lib/api';
import {
  exportSalesSummaryToCSV,
  exportSalesSummaryToExcel,
  exportSalesSummaryToPDF,
} from '@/lib/export-sales-summary';
import { useSettings } from '@/hooks/queries';
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
  generateReturnsReport,
  generateReturnsByCustomerReport,
  generateReturnsMonthlyReport,
  generateReturnsByReasonReport,
  exportSalesMoMToPDF,
  exportSalesWoWToPDF,
  exportSalesByCustomerToPDF,
  exportSalesByItemToPDF,
  exportTrendingToPDF,
  exportCustomerListToPDF,
  exportServicesToPDF,
  exportReturnsToPDF,
  exportReturnsByReasonToPDF,
} from '@/lib/export-utils';
import {
  exportRegisterReportToCSV,
  exportRegisterReportToExcel,
  exportCashierReportToCSV,
  exportCashierReportToExcel,
  exportDrawerVarianceReportToCSV,
  exportDrawerVarianceReportToExcel,
  exportNoSaleReportToCSV,
  exportNoSaleReportToExcel,
} from '@/lib/export-register-reports';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/errors';
import type { Product } from '@/lib/api';
import type { OrderItem, QuoteItem, ReturnItem, ExportRow } from '@/lib/export-utils';

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
  items?: OrderItem[];
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
  items?: QuoteItem[];
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

interface Return {
  id: string;
  returnNumber: string;
  returnType: string;
  status: string;
  customerEmail?: string;
  customerName?: string;
  total: number;
  refundMethod?: string;
  refundStatus: string;
  reasonCode?: string;
  createdAt: number;
  items?: ReturnItem[];
}

/**
 * The three format buttons for one report.
 *
 * At module scope, not inside `AdminExports`. Declared inside, it was a new
 * component *type* on every render, so React unmounted and remounted every
 * export button whenever any state changed — six times during the initial data
 * load alone. A keyboard user who had tabbed to a button lost focus each time,
 * and a click landing between the unmount and the remount went nowhere. Found
 * by a test whose click reached a detached node.
 */
function ExportButtons({
reportType,
formats,
loading,
onExport,
}: {
reportType: string;
formats: ('pdf' | 'excel' | 'csv')[];
loading: string | null;
onExport: (reportType: string, format: 'pdf' | 'excel' | 'csv') => void;
}) {
  const describes = (format: string) => `Export ${reportType.replace(/-/g, ' ')} as ${format}`;

  return (
  <div className="flex gap-2 flex-wrap">
    {formats.includes('pdf') && (
      <Button 
        size="sm" 
        variant="outline"
        onClick={() => onExport(reportType, 'pdf')}
        disabled={loading === reportType}
        aria-label={describes('PDF')}
      >
        <FileText className="w-4 h-4 mr-2" />
        PDF
      </Button>
    )}
    {formats.includes('excel') && (
      <Button 
        size="sm"
        variant="outline" 
        onClick={() => onExport(reportType, 'excel')}
        disabled={loading === reportType}
        aria-label={describes('Excel')}
      >
        <FileSpreadsheet className="w-4 h-4 mr-2" />
        Excel
      </Button>
    )}
    {formats.includes('csv') && (
      <Button 
        size="sm"
        variant="outline" 
        onClick={() => onExport(reportType, 'csv')}
        disabled={loading === reportType}
        aria-label={describes('CSV')}
      >
        <TableIcon className="w-4 h-4 mr-2" />
        CSV
      </Button>
    )}
    </div>
  );
}

export default function AdminExports() {
  // Store identity for the PDF header: an exported report that does not say
  // which shop it came from is not much use once it leaves the building.
  const { data: settings } = useSettings();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [loading, setLoading] = useState<string | null>(null);
  
  // Data
  const [orders, setOrders] = useState<Order[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [returns, setReturns] = useState<Return[]>([]);
  
  const { toast } = useToast();

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    try {
      const [ordersRes, quotesRes, customersRes, servicesRes, productsRes, returnsRes] = await Promise.all([
        ordersApi.list(),
        quotesApi.list(),
        customersApi.list(),
        servicesApi.list(),
        productsApi.list(),
        returnsApi.list(),
      ]);

      if (ordersRes) setOrders(ordersRes);
      if (quotesRes) setQuotes(quotesRes);
      if (customersRes) setCustomers(customersRes);
      if (servicesRes) setServices(servicesRes);
      if (productsRes) setProducts(productsRes);
      if (returnsRes) setReturns(returnsRes);
    } catch (error: unknown) {
      toast({
        title: 'Error loading data',
        description: getErrorMessage(error),
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
      /**
       * How many files actually reached the disk.
       *
       * `exportToCSV` and `exportToExcel` decline to write when a report has no
       * rows — a CSV takes its header from the first record and a workbook must
       * carry at least one sheet — and this handler used to report "Export
       * completed successfully" over that silence. On a store with no customers
       * or no services, six buttons on this screen did nothing at all and said
       * they had worked, which is worse than an error: the operator walks away
       * believing they hold figures they were never given.
       */
      let filesWritten = 0;
      const wrote = async (written: boolean | Promise<boolean>) => {
        if (await written) filesWritten += 1;
      };

      const filteredOrders = filterByDateRange(orders);
      const filteredQuotes = filterByDateRange(quotes);
      
      switch (reportType) {
        case 'sales-summary': {
          // Fetched at export time for the range currently on screen, rather
          // than aggregated from the loaded orders. That is the whole point of
          // this report: it is the same payload the Reports page renders, so
          // the exported totals are the screen's totals by construction and not
          // by two implementations happening to agree.
          const range = { from: startDate || undefined, to: endDate || undefined };
          const [summary, byDay, topProducts, paymentMix, returnsSummary, registerSales, cashierSales] =
            await Promise.all([
              reportsApi.salesSummary(range),
              reportsApi.salesByDay(range),
              reportsApi.topProducts({ ...range, limit: 100 }),
              reportsApi.paymentMix(range),
              reportsApi.returnsSummary(range),
              reportsApi.salesByRegister(range),
              reportsApi.salesByCashier(range),
            ]);

          const payload = {
            summary,
            byDay,
            topProducts,
            paymentMix,
            returns: returnsSummary,
            byRegister: registerSales.registers,
            byCashier: cashierSales,
          };

          if (format === 'pdf') {
            await exportSalesSummaryToPDF(payload, {
              storeName: settings?.storeName,
              storeEmail: settings?.storeEmail,
              storePhone: settings?.storePhone,
            });
          } else if (format === 'excel') {
            await wrote(exportSalesSummaryToExcel(payload));
          } else {
            await wrote(exportSalesSummaryToCSV(payload));
          }
          break;
        }

        case 'sales-register': {
          // Fetched fresh for the range on screen, same as sales-summary —
          // this is the report the whole reporting phase exists to answer,
          // and an export of it should not disagree with the Reports screen.
          const range = { from: startDate || undefined, to: endDate || undefined };
          const { registers } = await reportsApi.salesByRegister(range);
          if (format === 'excel') {
            await wrote(exportRegisterReportToExcel(registers, range));
          } else {
            await wrote(exportRegisterReportToCSV(registers, range));
          }
          break;
        }

        case 'sales-cashier': {
          const range = { from: startDate || undefined, to: endDate || undefined };
          const cashiers = await reportsApi.salesByCashier(range);
          if (format === 'excel') {
            await wrote(exportCashierReportToExcel(cashiers, range));
          } else {
            await wrote(exportCashierReportToCSV(cashiers, range));
          }
          break;
        }

        case 'drawer-variance': {
          const range = { from: startDate || undefined, to: endDate || undefined };
          const variance = await reportsApi.drawerVarianceByRegister(range);
          if (format === 'excel') {
            await wrote(exportDrawerVarianceReportToExcel(variance, range));
          } else {
            await wrote(exportDrawerVarianceReportToCSV(variance, range));
          }
          break;
        }

        case 'no-sale-counts': {
          const range = { from: startDate || undefined, to: endDate || undefined };
          const noSales = await reportsApi.noSaleCounts(range);
          if (format === 'excel') {
            await wrote(exportNoSaleReportToExcel(noSales, range));
          } else {
            await wrote(exportNoSaleReportToCSV(noSales, range));
          }
          break;
        }

        case 'sales-mom': {
          const data = generateSalesMoMReport(filteredOrders);
          if (format === 'pdf') {
            exportSalesMoMToPDF(data);
          } else if (format === 'excel') {
            await wrote(exportToExcel([{ name: 'Month over Month', data }], 'sales-mom.xlsx'));
          } else {
            await wrote(exportToCSV(data, 'sales-mom.csv'));
          }
          break;
        }
        
        case 'sales-wow': {
          const data = generateSalesWoWReport(filteredOrders);
          if (format === 'pdf') {
            exportSalesWoWToPDF(data);
          } else if (format === 'excel') {
            await wrote(exportToExcel([{ name: 'Week over Week', data }], 'sales-wow.xlsx'));
          } else {
            await wrote(exportToCSV(data, 'sales-wow.csv'));
          }
          break;
        }
        
        case 'sales-customer': {
          const data = generateSalesByCustomerReport(filteredOrders, customers);
          if (format === 'pdf') {
            exportSalesByCustomerToPDF(data);
          } else if (format === 'excel') {
            await wrote(exportToExcel([{ name: 'Sales by Customer', data }], 'sales-by-customer.xlsx'));
          } else {
            await wrote(exportToCSV(data, 'sales-by-customer.csv'));
          }
          break;
        }
        
        case 'sales-item': {
          const data = generateSalesByItemReport(filteredOrders);
          if (format === 'pdf') {
            exportSalesByItemToPDF(data);
          } else if (format === 'excel') {
            await wrote(exportToExcel([{ name: 'Sales by Item', data }], 'sales-by-item.xlsx'));
          } else {
            await wrote(exportToCSV(data, 'sales-by-item.csv'));
          }
          break;
        }
        
        case 'trending': {
          const { productTrends, serviceTrends } = generateTrendingReport(filteredOrders, filteredQuotes);
          if (format === 'pdf') {
            exportTrendingToPDF(productTrends, serviceTrends);
          } else if (format === 'excel') {
            await wrote(exportToExcel([
              { name: 'Product Trends', data: productTrends },
              { name: 'Service Trends', data: serviceTrends },
            ], 'trending-report.xlsx'));
          } else {
            await wrote(exportToCSV(productTrends, 'product-trends.csv'));
            await wrote(exportToCSV(serviceTrends, 'service-trends.csv'));
          }
          break;
        }
        
        case 'customer-list': {
          const data = generateCustomerListReport(customers);
          if (format === 'pdf') {
            exportCustomerListToPDF(data);
          } else if (format === 'excel') {
            await wrote(exportToExcel([{ name: 'Customers', data }], 'customers.xlsx'));
          } else {
            await wrote(exportToCSV(data, 'customers.csv'));
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
            await wrote(exportToExcel([
              { name: 'Customer Info', data: [customerInfo] },
              { name: 'Transactions', data: transactions },
            ], `customer-${customer.name.replace(/\s+/g, '-')}.xlsx`));
          } else {
            await wrote(exportToCSV(transactions, `customer-history-${customer.name.replace(/\s+/g, '-')}.csv`));
          }
          break;
        }
        
        case 'customer-history-all': {
          const allHistories: ExportRow[] = [];
          customers.forEach(customer => {
            const customerOrders = orders.filter(o => o.customerEmail === customer.email);
            const customerQuotes = quotes.filter(q => q.customerId === customer.id);
            const { transactions } = generateCustomerOrderHistoryReport(customer, customerOrders, customerQuotes);
            transactions.forEach(t => allHistories.push({ ...t, 'Customer': customer.name }));
          });
          
          if (format === 'excel') {
            await wrote(exportToExcel([{ name: 'All Customer History', data: allHistories }], 'all-customer-history.xlsx'));
          } else {
            await wrote(exportToCSV(allHistories, 'all-customer-history.csv'));
          }
          break;
        }
        
        case 'services-type': {
          const data = generateServicesByTypeReport(services);
          if (format === 'pdf') {
            exportServicesToPDF(data);
          } else if (format === 'excel') {
            await wrote(exportToExcel([{ name: 'Services', data }], 'services.xlsx'));
          } else {
            await wrote(exportToCSV(data, 'services.csv'));
          }
          break;
        }
        
        case 'services-category': {
          const data = generateServicesByCategoryReport(services, quotes);
          if (format === 'excel') {
            await wrote(exportToExcel([{ name: 'Services by Category', data }], 'services-by-category.xlsx'));
          } else {
            await wrote(exportToCSV(data, 'services-by-category.csv'));
          }
          break;
        }
        
        case 'inventory': {
          if (format === 'excel') {
            const data = products.flatMap(p => 
              p.variants.map((v) => ({
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
            await wrote(exportToExcel([{ name: 'Inventory', data }], 'inventory.xlsx'));
          } else {
            await wrote(exportInventoryToCSV(products));
          }
          break;
        }
        
        case 'returns-all': {
          const filteredReturns = filterByDateRange(returns);
          const data = generateReturnsReport(filteredReturns);
          if (format === 'pdf') {
            exportReturnsToPDF(filteredReturns);
          } else if (format === 'excel') {
            await wrote(exportToExcel([{ name: 'Returns', data }], 'returns.xlsx'));
          } else {
            await wrote(exportToCSV(data, 'returns.csv'));
          }
          break;
        }
        
        case 'returns-customer': {
          const filteredReturns = filterByDateRange(returns);
          const data = generateReturnsByCustomerReport(filteredReturns, customers);
          if (format === 'pdf') {
            exportReturnsByReasonToPDF(data);
          } else if (format === 'excel') {
            await wrote(exportToExcel([{ name: 'Returns by Customer', data }], 'returns-by-customer.xlsx'));
          } else {
            await wrote(exportToCSV(data, 'returns-by-customer.csv'));
          }
          break;
        }
        
        case 'returns-monthly': {
          const filteredReturns = filterByDateRange(returns);
          const data = generateReturnsMonthlyReport(filteredReturns);
          if (format === 'excel') {
            await wrote(exportToExcel([{ name: 'Monthly Returns', data }], 'returns-monthly.xlsx'));
          } else {
            await wrote(exportToCSV(data, 'returns-monthly.csv'));
          }
          break;
        }
        
        case 'returns-reason': {
          const filteredReturns = filterByDateRange(returns);
          const data = generateReturnsByReasonReport(filteredReturns);
          if (format === 'pdf') {
            exportReturnsByReasonToPDF(data);
          } else if (format === 'excel') {
            await wrote(exportToExcel([{ name: 'Returns by Reason', data }], 'returns-by-reason.xlsx'));
          } else {
            await wrote(exportToCSV(data, 'returns-by-reason.csv'));
          }
          break;
        }
      }
      
      // A PDF always renders, even with no rows — an empty report is still a
      // document stating the period was empty. The other two formats cannot
      // say that, so for them "no file" is the only honest thing to report.
      if (format !== 'pdf' && filesWritten === 0) {
        toast({
          title: 'Nothing to export',
          description: 'This report has no data for the selected range.',
        });
      } else {
        toast({ title: 'Export completed successfully' });
      }
    } catch (error: unknown) {
      toast({
        title: 'Export failed',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setLoading(null);
    }
  };

  /**
   * The three format buttons for one report.
   *
   * Each carries an `aria-label` naming the report as well as the format.
   * Without it this page renders fifteen buttons whose entire accessible name
   * is "CSV", and a screen reader user hears the same word fifteen times with
   * no way to tell which report they are about to download. The visible label
   * stays short because sighted users have the card heading directly above it.
   */
  return (
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
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="sales" className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              Sales
            </TabsTrigger>
            <TabsTrigger value="loss-prevention" className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" />
              Loss Prevention
            </TabsTrigger>
            <TabsTrigger value="returns" className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4" />
              Returns
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
              <Card className="md:col-span-2 border-primary/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-primary" />
                    Sales Summary
                  </CardTitle>
                  <CardDescription>
                    Gross, discounts, tax, net, refunds, daily takings, top products and tender
                    split — the same figures the Reports screen shows, taken from the same
                    server-computed source so the paper and the screen cannot disagree.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ExportButtons reportType="sales-summary" formats={['pdf', 'excel', 'csv']} loading={loading} onExport={handleExport} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-blue-500" />
                    Sales Month-over-Month
                  </CardTitle>
                  <CardDescription>Revenue and order trends by month</CardDescription>
                </CardHeader>
                <CardContent>
                  <ExportButtons reportType="sales-mom" formats={['pdf', 'excel', 'csv']} loading={loading} onExport={handleExport} />
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
                  <ExportButtons reportType="sales-wow" formats={['pdf', 'excel', 'csv']} loading={loading} onExport={handleExport} />
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
                  <ExportButtons reportType="sales-customer" formats={['pdf', 'excel', 'csv']} loading={loading} onExport={handleExport} />
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
                  <ExportButtons reportType="sales-item" formats={['pdf', 'excel', 'csv']} loading={loading} onExport={handleExport} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Store className="w-5 h-5 text-indigo-500" />
                    Sales by Register
                  </CardTitle>
                  <CardDescription>
                    Per-till transactions, net and average ticket, including the web-vs-drawer split
                    and any retired or disabled register that still traded in range.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ExportButtons reportType="sales-register" formats={['excel', 'csv']} loading={loading} onExport={handleExport} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-teal-500" />
                    Sales by Cashier
                  </CardTitle>
                  <CardDescription>Per-cashier transactions, net and average ticket</CardDescription>
                </CardHeader>
                <CardContent>
                  <ExportButtons reportType="sales-cashier" formats={['excel', 'csv']} loading={loading} onExport={handleExport} />
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
                  <ExportButtons reportType="trending" formats={['pdf', 'excel', 'csv']} loading={loading} onExport={handleExport} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Loss Prevention Tab — drawer variance and no-sale counts, the
              reports that catch problems. */}
          <TabsContent value="loss-prevention" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-red-500" />
                    Drawer Variance by Register
                  </CardTitle>
                  <CardDescription>
                    Closed drawer sessions whose counted cash did not match what was expected —
                    sessions, total variance, worst session, and short count per till.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ExportButtons reportType="drawer-variance" formats={['excel', 'csv']} loading={loading} onExport={handleExport} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-amber-500" />
                    No-Sale Counts
                  </CardTitle>
                  <CardDescription>
                    Drawers opened with nothing rung up, per register — the single best theft signal
                    a POS can report on.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ExportButtons reportType="no-sale-counts" formats={['excel', 'csv']} loading={loading} onExport={handleExport} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Returns Tab */}
          <TabsContent value="returns" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <RotateCcw className="w-5 h-5 text-red-500" />
                    All Returns
                  </CardTitle>
                  <CardDescription>Complete list of all returns and refunds</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="outline">{returns.length} returns</Badge>
                    <Badge variant="outline" className="bg-green-50 text-green-700">
                      {returns.filter(r => r.status === 'completed').length} completed
                    </Badge>
                  </div>
                  <ExportButtons reportType="returns-all" formats={['pdf', 'excel', 'csv']} loading={loading} onExport={handleExport} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-purple-500" />
                    Returns by Customer
                  </CardTitle>
                  <CardDescription>Which customers have the most returns</CardDescription>
                </CardHeader>
                <CardContent>
                  <ExportButtons reportType="returns-customer" formats={['pdf', 'excel', 'csv']} loading={loading} onExport={handleExport} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-blue-500" />
                    Returns Monthly Trend
                  </CardTitle>
                  <CardDescription>Return volume and refund amounts by month</CardDescription>
                </CardHeader>
                <CardContent>
                  <ExportButtons reportType="returns-monthly" formats={['excel', 'csv']} loading={loading} onExport={handleExport} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-orange-500" />
                    Returns by Reason
                  </CardTitle>
                  <CardDescription>Analysis of why products are being returned</CardDescription>
                </CardHeader>
                <CardContent>
                  <ExportButtons reportType="returns-reason" formats={['pdf', 'excel', 'csv']} loading={loading} onExport={handleExport} />
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
                  <ExportButtons reportType="customer-list" formats={['pdf', 'excel', 'csv']} loading={loading} onExport={handleExport} />
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
                  <ExportButtons reportType="customer-history" formats={['excel', 'csv']} loading={loading} onExport={handleExport} />
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
                  <ExportButtons reportType="customer-history-all" formats={['excel', 'csv']} loading={loading} onExport={handleExport} />
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
                  <ExportButtons reportType="services-type" formats={['pdf', 'excel', 'csv']} loading={loading} onExport={handleExport} />
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
                  <ExportButtons reportType="services-category" formats={['excel', 'csv']} loading={loading} onExport={handleExport} />
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
                <ExportButtons reportType="inventory" formats={['excel', 'csv']} loading={loading} onExport={handleExport} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
