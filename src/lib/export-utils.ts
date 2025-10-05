import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Order, OrderItem, Product, Settings } from './db';

export function exportToCSV(data: any[], filename: string) {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row => 
      headers.map(header => {
        const value = row[header];
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
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

export function exportOrdersToPDF(
  orders: Order[],
  orderItems: OrderItem[],
  settings: Settings,
  dateRange: { start: number; end: number }
) {
  const doc = new jsPDF();

  // Header
  doc.setFontSize(20);
  doc.text(settings.storeName, 14, 20);
  doc.setFontSize(10);
  doc.text(settings.storeEmail, 14, 28);
  doc.text(settings.storePhone, 14, 34);

  // Title
  doc.setFontSize(16);
  doc.text('Orders Report', 14, 48);
  
  // Date range
  doc.setFontSize(10);
  const startDate = new Date(dateRange.start).toLocaleDateString();
  const endDate = new Date(dateRange.end).toLocaleDateString();
  doc.text(`${startDate} - ${endDate}`, 14, 56);

  // Summary
  const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
  const totalOrders = orders.length;
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  doc.setFontSize(12);
  doc.text(`Total Orders: ${totalOrders}`, 14, 68);
  doc.text(`Total Revenue: $${totalRevenue.toFixed(2)}`, 14, 76);
  doc.text(`Average Ticket: $${avgTicket.toFixed(2)}`, 14, 84);

  // Orders table
  const tableData = orders.map(order => [
    order.id,
    new Date(order.createdAt).toLocaleDateString(),
    `$${order.subtotal.toFixed(2)}`,
    `$${order.taxTotal.toFixed(2)}`,
    `$${order.total.toFixed(2)}`,
    order.paymentMethod,
  ]);

  autoTable(doc, {
    startY: 94,
    head: [['Order ID', 'Date', 'Subtotal', 'Tax', 'Total', 'Payment']],
    body: tableData,
    theme: 'striped',
    headStyles: { fillColor: [99, 102, 241] },
  });

  doc.save(`orders-${startDate}-to-${endDate}.pdf`);
}

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
