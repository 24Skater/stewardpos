import type jsPDF from 'jspdf';

/**
 * jspdf, jspdf-autotable and xlsx are loaded on demand, not at import.
 *
 * Together they are the better part of a megabyte, and they exist to serve a
 * button a manager presses occasionally. Imported statically they landed in the
 * bundle every cashier downloads before ringing the first sale of the day.
 *
 * The cost is that every function which reaches for them is now async. Callers
 * fire these from click handlers and ignore the result, so nothing had to
 * change at the call sites — but an awaited caller now gets a promise that
 * settles when the file is actually saved, which is more honest than the old
 * signature was.
 */
async function loadPdfKit() {
  const [{ default: jsPDFCtor }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  return { jsPDFCtor, autoTable };
}

/**
 * One row of an exported report: column label -> cell value.
 *
 * Report rows are built dynamically and keyed by human-readable column names
 * ("Total Revenue"), so the key set is not known statically. Values are constrained
 * to primitives because that is what a CSV or spreadsheet cell can hold; numeric
 * work on a cell needs an explicit Number() at the call site.
 */
export type ExportRow = Record<string, string | number | boolean | null | undefined>;

/**
 * Read a report cell as a number.
 *
 * Report rows are assembled from mixed sources, so a numeric column can arrive as a
 * string. Coercing explicitly avoids the silent bug where `sum + cell` concatenates
 * instead of adding.
 */
function cellNum(value: ExportRow[string]): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Read a report cell as a string. */
function cellStr(value: ExportRow[string]): string {
  return value == null ? '' : String(value);
}

/** jsPDF instance after jspdf-autotable has run, which attaches lastAutoTable. */
type AutoTableDoc = jsPDF & { lastAutoTable: { finalY: number } };

// Types
export interface Order {
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

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  nameSnapshot: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
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

export interface QuoteItem {
  id: string;
  serviceId?: string;
  serviceName?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
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

interface Product {
  id: string;
  name: string;
  category: string;
  basePrice: number;
  variants: ProductVariant[];
}

interface ProductVariant {
  id: string;
  size?: string;
  color?: string;
  priceDelta?: number;
  priceOverride?: number;
  sku?: string;
  barcode?: string;
  stock: number;
  enabled: boolean;
}

interface Settings {
  storeName?: string;
  storeEmail?: string;
  storePhone?: string;
}

// ========== UTILITY FUNCTIONS ==========

export function exportToCSV(data: ExportRow[], filename: string) {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row => 
      headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    )
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

export async function exportToExcel(sheets: { name: string; data: ExportRow[] }[], filename: string) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  
  sheets.forEach(sheet => {
    if (sheet.data.length > 0) {
      const worksheet = XLSX.utils.json_to_sheet(sheet.data);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.substring(0, 31)); // Excel limit
    }
  });
  
  XLSX.writeFile(workbook, filename);
}

function createPDFHeader(doc: jsPDF, title: string, subtitle?: string, settings?: Settings) {
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(settings?.storeName || 'Steward · Register', 14, 20);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  if (settings?.storeEmail) doc.text(settings.storeEmail, 14, 28);
  if (settings?.storePhone) doc.text(settings.storePhone, 14, 34);
  
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 48);
  
  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(subtitle, 14, 56);
  }
  
  return subtitle ? 64 : 56;
}

function getMonthName(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

function getWeekLabel(date: Date): string {
  const startOfWeek = new Date(date);
  startOfWeek.setDate(date.getDate() - date.getDay());
  return `Week of ${startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

// ========== SALES REPORTS ==========

export function generateSalesMoMReport(orders: Order[]) {
  const monthlyData = new Map<string, { revenue: number; orders: number; items: number }>();
  
  orders.forEach(order => {
    const month = getMonthName(new Date(order.createdAt));
    const existing = monthlyData.get(month) || { revenue: 0, orders: 0, items: 0 };
    existing.revenue += order.total;
    existing.orders += 1;
    existing.items += order.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
    monthlyData.set(month, existing);
  });
  
  return Array.from(monthlyData.entries())
    .map(([month, data]) => ({
      'Month': month,
      'Total Revenue': data.revenue,
      'Order Count': data.orders,
      'Items Sold': data.items,
      'Avg Order Value': data.orders > 0 ? data.revenue / data.orders : 0,
    }))
    .sort((a, b) => new Date(b.Month).getTime() - new Date(a.Month).getTime());
}

export function generateSalesWoWReport(orders: Order[]) {
  const weeklyData = new Map<string, { revenue: number; orders: number; items: number; startDate: Date }>();
  
  orders.forEach(order => {
    const date = new Date(order.createdAt);
    const weekLabel = getWeekLabel(date);
    const startOfWeek = new Date(date);
    startOfWeek.setDate(date.getDate() - date.getDay());
    
    const existing = weeklyData.get(weekLabel) || { revenue: 0, orders: 0, items: 0, startDate: startOfWeek };
    existing.revenue += order.total;
    existing.orders += 1;
    existing.items += order.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
    weeklyData.set(weekLabel, existing);
  });
  
  return Array.from(weeklyData.entries())
    .map(([week, data]) => ({
      'Week': week,
      'Total Revenue': data.revenue,
      'Order Count': data.orders,
      'Items Sold': data.items,
      'Avg Order Value': data.orders > 0 ? data.revenue / data.orders : 0,
    }))
    .sort((a, b) => {
      const dateA = weeklyData.get(a.Week)?.startDate || new Date();
      const dateB = weeklyData.get(b.Week)?.startDate || new Date();
      return dateB.getTime() - dateA.getTime();
    });
}

export function generateSalesByCustomerReport(orders: Order[], customers: Customer[]) {
  const customerData = new Map<string, { name: string; email: string; revenue: number; orders: number }>();
  
  orders.forEach(order => {
    const key = order.customerEmail || 'Walk-in';
    const customer = customers.find(c => c.email === order.customerEmail);
    const existing = customerData.get(key) || { 
      name: customer?.name || 'Walk-in Customer', 
      email: key, 
      revenue: 0, 
      orders: 0 
    };
    existing.revenue += order.total;
    existing.orders += 1;
    customerData.set(key, existing);
  });
  
  return Array.from(customerData.values())
    .map(data => ({
      'Customer Name': data.name,
      'Email': data.email,
      'Total Revenue': data.revenue,
      'Order Count': data.orders,
      'Avg Order Value': data.orders > 0 ? data.revenue / data.orders : 0,
    }))
    .sort((a, b) => b['Total Revenue'] - a['Total Revenue']);
}

export function generateSalesByItemReport(orders: Order[]) {
  const itemData = new Map<string, { name: string; quantity: number; revenue: number }>();
  
  orders.forEach(order => {
    order.items?.forEach(item => {
      const existing = itemData.get(item.nameSnapshot) || { name: item.nameSnapshot, quantity: 0, revenue: 0 };
      existing.quantity += item.quantity;
      existing.revenue += item.lineTotal;
      itemData.set(item.nameSnapshot, existing);
    });
  });
  
  return Array.from(itemData.values())
    .map(data => ({
      'Product': data.name,
      'Quantity Sold': data.quantity,
      'Total Revenue': data.revenue,
      'Avg Price': data.quantity > 0 ? data.revenue / data.quantity : 0,
    }))
    .sort((a, b) => b['Total Revenue'] - a['Total Revenue']);
}

export function generateTrendingReport(orders: Order[], quotes: Quote[], days: number = 30) {
  const cutoffDate = Date.now() - days * 24 * 60 * 60 * 1000;
  const recentOrders = orders.filter(o => o.createdAt >= cutoffDate);
  const olderOrders = orders.filter(o => o.createdAt < cutoffDate && o.createdAt >= cutoffDate - days * 24 * 60 * 60 * 1000);
  
  // Product trends
  const recentItemSales = new Map<string, number>();
  const olderItemSales = new Map<string, number>();
  
  recentOrders.forEach(order => {
    order.items?.forEach(item => {
      recentItemSales.set(item.nameSnapshot, (recentItemSales.get(item.nameSnapshot) || 0) + item.quantity);
    });
  });
  
  olderOrders.forEach(order => {
    order.items?.forEach(item => {
      olderItemSales.set(item.nameSnapshot, (olderItemSales.get(item.nameSnapshot) || 0) + item.quantity);
    });
  });
  
  const productTrends = Array.from(recentItemSales.entries()).map(([name, recentQty]) => {
    const olderQty = olderItemSales.get(name) || 0;
    const change = olderQty > 0 ? ((recentQty - olderQty) / olderQty) * 100 : (recentQty > 0 ? 100 : 0);
    return {
      'Product': name,
      'Recent Sales': recentQty,
      'Previous Period': olderQty,
      'Change %': change,
      'Trend': change > 10 ? '📈 Growing' : change < -10 ? '📉 Declining' : '➡️ Stable',
    };
  }).sort((a, b) => b['Change %'] - a['Change %']);
  
  // Service trends from quotes
  const recentQuotes = quotes.filter(q => q.createdAt >= cutoffDate && q.status === 'completed');
  const serviceTrends = new Map<string, number>();
  
  recentQuotes.forEach(quote => {
    quote.items?.forEach(item => {
      serviceTrends.set(item.description, (serviceTrends.get(item.description) || 0) + item.quantity);
    });
  });
  
  const topServices = Array.from(serviceTrends.entries())
    .map(([name, qty]) => ({
      'Service': name,
      'Completions': qty,
    }))
    .sort((a, b) => b.Completions - a.Completions)
    .slice(0, 10);
  
  return { productTrends: productTrends.slice(0, 20), serviceTrends: topServices };
}

// ========== CUSTOMER REPORTS ==========

export function generateCustomerListReport(customers: Customer[]) {
  return customers.map(c => ({
    'Name': c.name,
    'Organization': c.org || '',
    'Email': c.email || '',
    'Phone': c.phone || '',
    'Address': c.address || '',
    'City': c.city || '',
    'State': c.state || '',
    'ZIP': c.zip || '',
    'Country': c.country || '',
    'Created': new Date(c.createdAt).toLocaleDateString(),
  }));
}

export function generateCustomerOrderHistoryReport(
  customer: Customer, 
  orders: Order[], 
  quotes: Quote[]
) {
  const orderData = orders.map(o => ({
    'Type': 'POS Sale',
    'ID': o.id,
    'Date': new Date(o.createdAt).toLocaleDateString(),
    'Items': o.items?.length || 0,
    'Total': o.total,
    'Status': 'Completed',
    'Payment': o.paymentMethod,
  }));
  
  const quoteData = quotes.map(q => ({
    'Type': 'Service Quote',
    'ID': q.id,
    'Date': new Date(q.createdAt).toLocaleDateString(),
    'Items': q.items?.length || 0,
    'Total': q.total,
    'Status': q.status,
    'Payment': '-',
  }));
  
  return {
    customer: {
      'Name': customer.name,
      'Email': customer.email || '',
      'Phone': customer.phone || '',
      'Total POS Sales': orderData.reduce((sum, o) => sum + o.Total, 0),
      'Total Service Revenue': quoteData.filter(q => q.Status === 'completed').reduce((sum, q) => sum + q.Total, 0),
    },
    transactions: [...orderData, ...quoteData].sort((a, b) => 
      new Date(b.Date).getTime() - new Date(a.Date).getTime()
    ),
  };
}

// ========== SERVICE REPORTS ==========

export function generateServicesByTypeReport(services: Service[]) {
  return services.map(s => ({
    'Name': s.name,
    'Category': s.category,
    'Description': s.description || '',
    'Base Price': s.basePrice || 0,
    'Unit Type': s.unitType || '',
    'Active': s.isActive ? 'Yes' : 'No',
  }));
}

export function generateServicesByCategoryReport(services: Service[], quotes: Quote[]) {
  const categoryData = new Map<string, { count: number; revenue: number; completions: number }>();
  
  // Count services by category
  services.forEach(s => {
    const existing = categoryData.get(s.category) || { count: 0, revenue: 0, completions: 0 };
    existing.count += 1;
    categoryData.set(s.category, existing);
  });
  
  // Add revenue from completed quotes
  quotes.filter(q => q.status === 'completed').forEach(quote => {
    quote.items?.forEach(item => {
      const service = services.find(s => s.id === item.serviceId);
      if (service) {
        const existing = categoryData.get(service.category) || { count: 0, revenue: 0, completions: 0 };
        existing.revenue += item.lineTotal;
        existing.completions += 1;
        categoryData.set(service.category, existing);
      }
    });
  });
  
  return Array.from(categoryData.entries()).map(([category, data]) => ({
    'Category': category,
    'Service Count': data.count,
    'Total Revenue': data.revenue,
    'Completions': data.completions,
  })).sort((a, b) => b['Total Revenue'] - a['Total Revenue']);
}

// ========== PDF EXPORTS ==========

export async function exportOrdersToPDF(
  orders: Order[],
  orderItems: OrderItem[],
  settings: Settings,
  dateRange: { start: number; end: number }
) {
  const { jsPDFCtor, autoTable } = await loadPdfKit();
  const doc = new jsPDFCtor();
  const startY = createPDFHeader(doc, 'Orders Report', 
    `${new Date(dateRange.start).toLocaleDateString()} - ${new Date(dateRange.end).toLocaleDateString()}`,
    settings
  );

  // Summary
  const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
  const totalOrders = orders.length;
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  doc.setFontSize(12);
  doc.text(`Total Orders: ${totalOrders}`, 14, startY);
  doc.text(`Total Revenue: $${totalRevenue.toFixed(2)}`, 14, startY + 8);
  doc.text(`Average Ticket: $${avgTicket.toFixed(2)}`, 14, startY + 16);

  // Orders table
  const tableData = orders.map(order => [
    order.id.slice(0, 8) + '...',
    new Date(order.createdAt).toLocaleDateString(),
    `$${order.subtotal.toFixed(2)}`,
    `$${order.taxTotal.toFixed(2)}`,
    `$${order.total.toFixed(2)}`,
    order.paymentMethod,
  ]);

  autoTable(doc, {
    startY: startY + 26,
    head: [['Order ID', 'Date', 'Subtotal', 'Tax', 'Total', 'Payment']],
    body: tableData,
    theme: 'striped',
    headStyles: { fillColor: [99, 102, 241] },
  });

  doc.save(`orders-report-${new Date().toISOString().split('T')[0]}.pdf`);
}

export async function exportSalesMoMToPDF(data: ExportRow[], settings?: Settings) {
  const { jsPDFCtor, autoTable } = await loadPdfKit();
  const doc = new jsPDFCtor();
  const startY = createPDFHeader(doc, 'Sales Month-over-Month Report', 
    `Generated: ${new Date().toLocaleDateString()}`, settings);
  
  const totalRevenue = data.reduce((sum, row) => sum + cellNum(row['Total Revenue']), 0);
  const totalOrders = data.reduce((sum, row) => sum + cellNum(row['Order Count']), 0);
  
  doc.setFontSize(12);
  doc.text(`Total Revenue: $${totalRevenue.toFixed(2)}`, 14, startY);
  doc.text(`Total Orders: ${totalOrders}`, 14, startY + 8);
  
  autoTable(doc, {
    startY: startY + 18,
    head: [['Month', 'Revenue', 'Orders', 'Items', 'Avg Order']],
    body: data.map(row => [
      row.Month,
      `$${cellNum(row['Total Revenue']).toFixed(2)}`,
      row['Order Count'],
      row['Items Sold'],
      `$${cellNum(row['Avg Order Value']).toFixed(2)}`,
    ]),
    theme: 'striped',
    headStyles: { fillColor: [99, 102, 241] },
  });
  
  doc.save(`sales-mom-${new Date().toISOString().split('T')[0]}.pdf`);
}

export async function exportSalesWoWToPDF(data: ExportRow[], settings?: Settings) {
  const { jsPDFCtor, autoTable } = await loadPdfKit();
  const doc = new jsPDFCtor();
  const startY = createPDFHeader(doc, 'Sales Week-over-Week Report', 
    `Generated: ${new Date().toLocaleDateString()}`, settings);
  
  autoTable(doc, {
    startY,
    head: [['Week', 'Revenue', 'Orders', 'Items', 'Avg Order']],
    body: data.map(row => [
      row.Week,
      `$${cellNum(row['Total Revenue']).toFixed(2)}`,
      row['Order Count'],
      row['Items Sold'],
      `$${cellNum(row['Avg Order Value']).toFixed(2)}`,
    ]),
    theme: 'striped',
    headStyles: { fillColor: [99, 102, 241] },
  });
  
  doc.save(`sales-wow-${new Date().toISOString().split('T')[0]}.pdf`);
}

export async function exportSalesByCustomerToPDF(data: ExportRow[], settings?: Settings) {
  const { jsPDFCtor, autoTable } = await loadPdfKit();
  const doc = new jsPDFCtor();
  const startY = createPDFHeader(doc, 'Sales by Customer Report', 
    `Generated: ${new Date().toLocaleDateString()}`, settings);
  
  autoTable(doc, {
    startY,
    head: [['Customer', 'Email', 'Revenue', 'Orders', 'Avg Order']],
    body: data.slice(0, 50).map(row => [
      cellStr(row['Customer Name']).substring(0, 20),
      cellStr(row.Email).substring(0, 25),
      `$${cellNum(row['Total Revenue']).toFixed(2)}`,
      row['Order Count'],
      `$${cellNum(row['Avg Order Value']).toFixed(2)}`,
    ]),
    theme: 'striped',
    headStyles: { fillColor: [99, 102, 241] },
  });
  
  doc.save(`sales-by-customer-${new Date().toISOString().split('T')[0]}.pdf`);
}

export async function exportSalesByItemToPDF(data: ExportRow[], settings?: Settings) {
  const { jsPDFCtor, autoTable } = await loadPdfKit();
  const doc = new jsPDFCtor();
  const startY = createPDFHeader(doc, 'Sales by Item Report', 
    `Generated: ${new Date().toLocaleDateString()}`, settings);
  
  autoTable(doc, {
    startY,
    head: [['Product', 'Qty Sold', 'Revenue', 'Avg Price']],
    body: data.slice(0, 50).map(row => [
      cellStr(row.Product).substring(0, 30),
      row['Quantity Sold'],
      `$${cellNum(row['Total Revenue']).toFixed(2)}`,
      `$${cellNum(row['Avg Price']).toFixed(2)}`,
    ]),
    theme: 'striped',
    headStyles: { fillColor: [99, 102, 241] },
  });
  
  doc.save(`sales-by-item-${new Date().toISOString().split('T')[0]}.pdf`);
}

export async function exportTrendingToPDF(productTrends: ExportRow[], serviceTrends: ExportRow[], settings?: Settings) {
  const { jsPDFCtor, autoTable } = await loadPdfKit();
  const doc = new jsPDFCtor();
  const startY = createPDFHeader(doc, 'Trending Products & Services Report', 
    `Last 30 Days | Generated: ${new Date().toLocaleDateString()}`, settings);
  
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Product Trends', 14, startY);
  
  autoTable(doc, {
    startY: startY + 6,
    head: [['Product', 'Recent', 'Previous', 'Change', 'Trend']],
    body: productTrends.slice(0, 15).map(row => [
      cellStr(row.Product).substring(0, 25),
      row['Recent Sales'],
      row['Previous Period'],
      `${cellNum(row['Change %']).toFixed(1)}%`,
      row.Trend,
    ]),
    theme: 'striped',
    headStyles: { fillColor: [99, 102, 241] },
  });
  
  const afterProductTable = (doc as AutoTableDoc).lastAutoTable.finalY + 15;
  
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Top Services', 14, afterProductTable);
  
  autoTable(doc, {
    startY: afterProductTable + 6,
    head: [['Service', 'Completions']],
    body: serviceTrends.map(row => [row.Service, row.Completions]),
    theme: 'striped',
    headStyles: { fillColor: [139, 92, 246] },
  });
  
  doc.save(`trending-report-${new Date().toISOString().split('T')[0]}.pdf`);
}

export async function exportCustomerListToPDF(data: ExportRow[], settings?: Settings) {
  const { jsPDFCtor, autoTable } = await loadPdfKit();
  const doc = new jsPDFCtor('landscape');
  const startY = createPDFHeader(doc, 'Customer List', 
    `Total: ${data.length} customers | Generated: ${new Date().toLocaleDateString()}`, settings);
  
  autoTable(doc, {
    startY,
    head: [['Name', 'Organization', 'Email', 'Phone', 'City', 'State']],
    body: data.map(row => [
      row.Name,
      row.Organization,
      row.Email,
      row.Phone,
      row.City,
      row.State,
    ]),
    theme: 'striped',
    headStyles: { fillColor: [99, 102, 241] },
    styles: { fontSize: 9 },
  });
  
  doc.save(`customers-${new Date().toISOString().split('T')[0]}.pdf`);
}

export async function exportServicesToPDF(data: ExportRow[], settings?: Settings) {
  const { jsPDFCtor, autoTable } = await loadPdfKit();
  const doc = new jsPDFCtor();
  const startY = createPDFHeader(doc, 'Services Report', 
    `Total: ${data.length} services | Generated: ${new Date().toLocaleDateString()}`, settings);
  
  autoTable(doc, {
    startY,
    head: [['Name', 'Category', 'Base Price', 'Unit Type', 'Active']],
    body: data.map(row => [
      row.Name,
      row.Category,
      `$${cellNum(row['Base Price']).toFixed(2)}`,
      row['Unit Type'],
      row.Active,
    ]),
    theme: 'striped',
    headStyles: { fillColor: [139, 92, 246] },
  });
  
  doc.save(`services-${new Date().toISOString().split('T')[0]}.pdf`);
}

// ========== RETURNS & REFUNDS REPORTS ==========

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

export interface ReturnItem {
  id: string;
  productId: string;
  nameSnapshot: string;
  returnQuantity: number;
  unitPrice: number;
  lineTotal: number;
  condition: string;
  restocked: boolean;
}

export function generateReturnsReport(returns: Return[]) {
  return returns.map(r => ({
    'Return #': r.returnNumber,
    'Date': new Date(r.createdAt).toLocaleDateString(),
    'Type': r.returnType,
    'Customer': r.customerName || r.customerEmail || 'Guest',
    'Status': r.status,
    'Refund Method': r.refundMethod || 'Pending',
    'Refund Status': r.refundStatus,
    'Reason': r.reasonCode || 'Not specified',
    'Total': r.total,
    'Items': r.items?.length || 0,
  }));
}

export function generateReturnsByCustomerReport(returns: Return[], customers: Customer[]) {
  const customerData = new Map<string, { name: string; email: string; returns: number; totalRefunded: number }>();
  
  returns.forEach(ret => {
    const key = ret.customerEmail || 'Walk-in';
    const customer = customers.find(c => c.email === ret.customerEmail);
    const existing = customerData.get(key) || { 
      name: customer?.name || ret.customerName || 'Walk-in', 
      email: key, 
      returns: 0, 
      totalRefunded: 0 
    };
    existing.returns += 1;
    if (ret.status === 'completed') {
      existing.totalRefunded += ret.total;
    }
    customerData.set(key, existing);
  });
  
  return Array.from(customerData.values())
    .map(data => ({
      'Customer Name': data.name,
      'Email': data.email,
      'Total Returns': data.returns,
      'Total Refunded': data.totalRefunded,
    }))
    .sort((a, b) => b['Total Returns'] - a['Total Returns']);
}

export function generateReturnsMonthlyReport(returns: Return[]) {
  const monthlyData = new Map<string, { count: number; refunded: number; pending: number }>();
  
  returns.forEach(ret => {
    const month = getMonthName(new Date(ret.createdAt));
    const existing = monthlyData.get(month) || { count: 0, refunded: 0, pending: 0 };
    existing.count += 1;
    if (ret.status === 'completed') {
      existing.refunded += ret.total;
    } else if (ret.status === 'pending') {
      existing.pending += ret.total;
    }
    monthlyData.set(month, existing);
  });
  
  return Array.from(monthlyData.entries())
    .map(([month, data]) => ({
      'Month': month,
      'Total Returns': data.count,
      'Refunded Amount': data.refunded,
      'Pending Amount': data.pending,
    }))
    .sort((a, b) => new Date(b.Month).getTime() - new Date(a.Month).getTime());
}

export function generateReturnsByReasonReport(returns: Return[]) {
  const reasonLabels: Record<string, string> = {
    defective: 'Defective Product',
    wrong_item: 'Wrong Item',
    not_needed: 'No Longer Needed',
    damaged: 'Damaged',
    other: 'Other',
  };
  
  const reasonData = new Map<string, { count: number; total: number }>();
  
  returns.forEach(ret => {
    const reason = ret.reasonCode || 'other';
    const existing = reasonData.get(reason) || { count: 0, total: 0 };
    existing.count += 1;
    existing.total += ret.total;
    reasonData.set(reason, existing);
  });
  
  return Array.from(reasonData.entries())
    .map(([reason, data]) => ({
      'Reason': reasonLabels[reason] || reason,
      'Return Count': data.count,
      'Total Value': data.total,
      'Percentage': returns.length > 0 ? ((data.count / returns.length) * 100) : 0,
    }))
    .sort((a, b) => b['Return Count'] - a['Return Count']);
}

export async function exportReturnsToPDF(returns: Return[], settings?: Settings) {
  const { jsPDFCtor, autoTable } = await loadPdfKit();
  const doc = new jsPDFCtor();
  const startY = createPDFHeader(doc, 'Returns & Refunds Report', 
    `Generated: ${new Date().toLocaleDateString()}`, settings);
  
  const totalReturns = returns.length;
  const completedReturns = returns.filter(r => r.status === 'completed').length;
  const totalRefunded = returns.filter(r => r.status === 'completed').reduce((sum, r) => sum + r.total, 0);
  
  doc.setFontSize(12);
  doc.text(`Total Returns: ${totalReturns}`, 14, startY);
  doc.text(`Completed: ${completedReturns}`, 14, startY + 8);
  doc.text(`Total Refunded: $${totalRefunded.toFixed(2)}`, 14, startY + 16);
  
  autoTable(doc, {
    startY: startY + 26,
    head: [['Return #', 'Date', 'Customer', 'Status', 'Refund Status', 'Total']],
    body: returns.slice(0, 50).map(ret => [
      ret.returnNumber,
      new Date(ret.createdAt).toLocaleDateString(),
      (ret.customerName || ret.customerEmail || 'Guest').substring(0, 20),
      ret.status,
      ret.refundStatus,
      `$${ret.total.toFixed(2)}`,
    ]),
    theme: 'striped',
    headStyles: { fillColor: [239, 68, 68] },
  });
  
  doc.save(`returns-report-${new Date().toISOString().split('T')[0]}.pdf`);
}

export async function exportReturnsByReasonToPDF(data: ExportRow[], settings?: Settings) {
  const { jsPDFCtor, autoTable } = await loadPdfKit();
  const doc = new jsPDFCtor();
  const startY = createPDFHeader(doc, 'Returns by Reason Report', 
    `Generated: ${new Date().toLocaleDateString()}`, settings);
  
  autoTable(doc, {
    startY,
    head: [['Reason', 'Count', 'Total Value', 'Percentage']],
    body: data.map(row => [
      row.Reason,
      row['Return Count'],
      `$${cellNum(row['Total Value']).toFixed(2)}`,
      `${cellNum(row.Percentage).toFixed(1)}%`,
    ]),
    theme: 'striped',
    headStyles: { fillColor: [239, 68, 68] },
  });
  
  doc.save(`returns-by-reason-${new Date().toISOString().split('T')[0]}.pdf`);
}

// ========== LEGACY EXPORTS ==========

export function exportInventoryToCSV(products: Product[]) {
  const data = products.flatMap(product =>
    product.variants.map(variant => ({
      'Product ID': product.id,
      'Product Name': product.name,
      'Category': product.category,
      'Base Price': product.basePrice,
      'Variant ID': variant.id,
      'Size': variant.size || 'N/A',
      'Color': variant.color || 'N/A',
      'Price Delta': variant.priceDelta || 0,
      'Price Override': variant.priceOverride || '',
      'SKU': variant.sku || '',
      'Barcode': variant.barcode || '',
      'Stock': variant.stock,
      'Enabled': variant.enabled ? 'Yes' : 'No',
    }))
  );

  exportToCSV(data, `inventory-${new Date().toISOString().split('T')[0]}.csv`);
}
