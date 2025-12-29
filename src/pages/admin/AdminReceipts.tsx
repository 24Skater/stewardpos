import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { 
  Receipt, Search, Eye, Send, Download, RotateCcw, CalendarDays,
  FileText, Mail, RefreshCw, Printer, ChevronLeft, ChevronRight
} from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { format, subDays, subMonths } from 'date-fns';
import { exportToCSV, exportToExcel, exportOrdersToPDF } from '@/lib/export-utils';

interface OrderItem {
  id: string;
  productId: string;
  nameSnapshot: string;
  size?: string;
  color?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface ReceiptOrder {
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
  hasReturns?: boolean;
  returnCount?: number;
  totalReturned?: number;
  netTotal?: number;
  emailHistory?: EmailLog[];
  returns?: any[];
}

interface EmailLog {
  id: string;
  recipientEmail: string;
  subject: string;
  status: string;
  sentByName?: string;
  sentAt: number;
}

interface ReturnableItem {
  originalOrderItemId: string;
  productId: string;
  nameSnapshot: string;
  size?: string;
  color?: string;
  originalQuantity: number;
  alreadyReturned: number;
  returnableQuantity: number;
  unitPrice: number;
  canReturn: boolean;
}

export default function AdminReceipts() {
  const [receipts, setReceipts] = useState<ReceiptOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState<Date | undefined>(subMonths(new Date(), 1));
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptOrder | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [returnableItems, setReturnableItems] = useState<ReturnableItem[]>([]);
  const [selectedReturnItems, setSelectedReturnItems] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState('not_needed');
  const [returnNotes, setReturnNotes] = useState('');
  const [creatingReturn, setCreatingReturn] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 25;
  const { toast } = useToast();

  useEffect(() => {
    loadReceipts();
  }, [page, startDate, endDate, paymentFilter]);

  const loadReceipts = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('limit', pageSize.toString());
      params.append('offset', (page * pageSize).toString());
      
      if (searchQuery) {
        params.append('query', searchQuery);
      }
      if (startDate) {
        params.append('startDate', startDate.getTime().toString());
      }
      if (endDate) {
        params.append('endDate', endDate.getTime().toString());
      }
      if (paymentFilter !== 'all') {
        params.append('paymentMethod', paymentFilter);
      }

      const response = await apiClient.get<{ 
        success: boolean; 
        data: ReceiptOrder[]; 
        pagination: { total: number; hasMore: boolean } 
      }>(`/api/receipts?${params.toString()}`);
      
      if (response.success) {
        setReceipts(response.data);
        setHasMore(response.pagination?.hasMore ?? false);
      }
    } catch (error: any) {
      toast({ title: 'Error loading receipts', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPage(0);
    loadReceipts();
  };

  const loadReceiptDetails = async (orderId: string) => {
    try {
      const response = await apiClient.get<{ success: boolean; data: ReceiptOrder }>(
        `/api/receipts/${orderId}`
      );
      if (response.success) {
        setSelectedReceipt(response.data);
        setResendEmail(response.data.customerEmail || '');
        setDetailsOpen(true);
      }
    } catch (error: any) {
      toast({ title: 'Error loading receipt', description: error.message, variant: 'destructive' });
    }
  };

  const handleResendReceipt = async () => {
    if (!selectedReceipt || !resendEmail) return;
    
    setSending(true);
    try {
      await apiClient.post(`/api/receipts/${selectedReceipt.id}/resend`, {
        email: resendEmail,
        includeItems: true,
      });
      toast({ title: 'Receipt sent', description: `Sent to ${resendEmail}` });
      setResendOpen(false);
      loadReceiptDetails(selectedReceipt.id);
    } catch (error: any) {
      toast({ title: 'Failed to send receipt', description: error.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const handleStartReturn = async () => {
    if (!selectedReceipt) return;
    
    try {
      const response = await apiClient.post<{ 
        success: boolean; 
        data: { returnableItems: ReturnableItem[]; hasReturnableItems: boolean } 
      }>(`/api/receipts/${selectedReceipt.id}/start-return`, {});
      
      if (response.success) {
        if (!response.data.hasReturnableItems) {
          toast({ title: 'No items to return', description: 'All items have already been returned.', variant: 'destructive' });
          return;
        }
        setReturnableItems(response.data.returnableItems);
        setSelectedReturnItems({});
        setReturnReason('not_needed');
        setReturnNotes('');
        setReturnOpen(true);
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleCreateReturn = async () => {
    if (!selectedReceipt) return;
    
    const itemsToReturn = returnableItems
      .filter(item => selectedReturnItems[item.originalOrderItemId] > 0)
      .map(item => ({
        originalOrderItemId: item.originalOrderItemId,
        productId: item.productId,
        nameSnapshot: item.nameSnapshot,
        size: item.size,
        color: item.color,
        originalQuantity: item.originalQuantity,
        returnQuantity: selectedReturnItems[item.originalOrderItemId],
        unitPrice: item.unitPrice,
        lineTotal: item.unitPrice * selectedReturnItems[item.originalOrderItemId],
        condition: 'good',
      }));

    if (itemsToReturn.length === 0) {
      toast({ title: 'Select items to return', variant: 'destructive' });
      return;
    }

    const subtotal = itemsToReturn.reduce((sum, item) => sum + item.lineTotal, 0);
    const taxRate = selectedReceipt.taxTotal / selectedReceipt.subtotal || 0;
    const taxTotal = subtotal * taxRate;

    setCreatingReturn(true);
    try {
      await apiClient.post('/api/returns', {
        originalOrderId: selectedReceipt.id,
        returnType: 'return',
        customerEmail: selectedReceipt.customerEmail,
        customerPhone: selectedReceipt.customerPhone,
        items: itemsToReturn,
        subtotal,
        taxTotal,
        total: subtotal + taxTotal,
        reasonCode: returnReason,
        reasonDetails: returnNotes,
        restockItems: true,
      });

      toast({ title: 'Return created', description: 'The return has been submitted for review.' });
      setReturnOpen(false);
      loadReceiptDetails(selectedReceipt.id);
    } catch (error: any) {
      toast({ title: 'Failed to create return', description: error.message, variant: 'destructive' });
    } finally {
      setCreatingReturn(false);
    }
  };

  const handleExportReceipts = (format: 'csv' | 'excel' | 'pdf') => {
    if (receipts.length === 0) {
      toast({ title: 'No data to export', variant: 'destructive' });
      return;
    }

    const exportData = receipts.map(r => ({
      'Receipt ID': r.id.slice(0, 8).toUpperCase(),
      'Date': format === 'csv' ? new Date(r.createdAt).toISOString() : format === 'excel' ? new Date(r.createdAt) : new Date(r.createdAt).toLocaleDateString(),
      'Customer Email': r.customerEmail || 'N/A',
      'Payment Method': r.paymentMethod,
      'Subtotal': r.subtotal,
      'Tax': r.taxTotal,
      'Total': r.total,
      'Has Returns': r.hasReturns ? 'Yes' : 'No',
      'Net Total': r.netTotal ?? r.total,
    }));

    const filename = `receipts-${format}-${Date.now()}`;

    if (format === 'csv') {
      exportToCSV(exportData, `${filename}.csv`);
    } else if (format === 'excel') {
      exportToExcel(exportData, `${filename}.xlsx`, 'Receipts');
    } else {
      // For PDF, use existing orders PDF export
      exportOrdersToPDF(receipts as any, { storeName: 'StewardPOS', storeAddress: '', storePhone: '' } as any, `${filename}.pdf`);
    }

    toast({ title: 'Export complete', description: `Downloaded ${format.toUpperCase()} file` });
  };

  const filteredReceipts = receipts.filter(receipt => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      receipt.id.toLowerCase().includes(query) ||
      receipt.customerEmail?.toLowerCase().includes(query)
    );
  });

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
                <Receipt className="h-8 w-8" />
                Receipts
              </h1>
              <p className="text-muted-foreground">View, resend, and manage sales receipts</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => handleExportReceipts('csv')}>
                <Download className="h-4 w-4 mr-2" />
                CSV
              </Button>
              <Button variant="outline" onClick={() => handleExportReceipts('excel')}>
                <FileText className="h-4 w-4 mr-2" />
                Excel
              </Button>
              <Button variant="outline" onClick={() => handleExportReceipts('pdf')}>
                <Printer className="h-4 w-4 mr-2" />
                PDF
              </Button>
            </div>
          </div>

          {/* Filters */}
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[250px]">
                  <Label>Search</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                    <Input
                      placeholder="Search by receipt ID or customer email..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      className="pl-10"
                    />
                  </div>
                </div>
                
                <div>
                  <Label>Start Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-[180px] justify-start">
                        <CalendarDays className="mr-2 h-4 w-4" />
                        {startDate ? format(startDate, 'PP') : 'Select'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={startDate} onSelect={setStartDate} />
                    </PopoverContent>
                  </Popover>
                </div>

                <div>
                  <Label>End Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-[180px] justify-start">
                        <CalendarDays className="mr-2 h-4 w-4" />
                        {endDate ? format(endDate, 'PP') : 'Select'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={endDate} onSelect={setEndDate} />
                    </PopoverContent>
                  </Popover>
                </div>

                <div>
                  <Label>Payment Method</Label>
                  <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="mobile">Mobile</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button onClick={handleSearch}>
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </Button>
              </div>

              <div className="flex gap-2 mt-4">
                <Button variant="ghost" size="sm" onClick={() => { setStartDate(subDays(new Date(), 7)); setEndDate(new Date()); setPage(0); }}>
                  Last 7 Days
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setStartDate(subDays(new Date(), 30)); setEndDate(new Date()); setPage(0); }}>
                  Last 30 Days
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setStartDate(subMonths(new Date(), 3)); setEndDate(new Date()); setPage(0); }}>
                  Last 3 Months
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setStartDate(undefined); setEndDate(undefined); setPage(0); }}>
                  All Time
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Receipts Table */}
          <Card>
            <CardHeader>
              <CardTitle>Receipts</CardTitle>
              <CardDescription>
                Showing {filteredReceipts.length} receipt{filteredReceipts.length !== 1 ? 's' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : filteredReceipts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No receipts found</p>
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Receipt ID</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Returns</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredReceipts.map((receipt) => (
                        <TableRow key={receipt.id}>
                          <TableCell className="font-mono font-medium">
                            {receipt.id.slice(0, 8).toUpperCase()}
                          </TableCell>
                          <TableCell>{format(new Date(receipt.createdAt), 'MMM d, yyyy h:mm a')}</TableCell>
                          <TableCell>
                            {receipt.customerEmail || <span className="text-muted-foreground">Guest</span>}
                          </TableCell>
                          <TableCell className="capitalize">{receipt.paymentMethod}</TableCell>
                          <TableCell className="text-right font-medium">${receipt.total.toFixed(2)}</TableCell>
                          <TableCell>
                            {receipt.hasReturns ? (
                              <Badge className="bg-orange-100 text-orange-800">
                                {receipt.returnCount} return{receipt.returnCount !== 1 ? 's' : ''}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {receipt.hasReturns ? (
                              <span className="font-medium text-green-600">
                                ${(receipt.netTotal ?? receipt.total).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => loadReceiptDetails(receipt.id)}>
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* Pagination */}
                  <div className="flex justify-between items-center mt-4">
                    <p className="text-sm text-muted-foreground">
                      Page {page + 1}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => p + 1)}
                        disabled={!hasMore}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Receipt Details Dialog */}
          <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              {selectedReceipt && (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-4">
                      <Receipt className="h-5 w-5" />
                      Receipt #{selectedReceipt.id.slice(0, 8).toUpperCase()}
                    </DialogTitle>
                    <DialogDescription>
                      {format(new Date(selectedReceipt.createdAt), 'PPP p')}
                    </DialogDescription>
                  </DialogHeader>

                  <Tabs defaultValue="receipt">
                    <TabsList>
                      <TabsTrigger value="receipt">Receipt</TabsTrigger>
                      <TabsTrigger value="history">Email History</TabsTrigger>
                      {selectedReceipt.returns && selectedReceipt.returns.length > 0 && (
                        <TabsTrigger value="returns">Returns ({selectedReceipt.returns.length})</TabsTrigger>
                      )}
                    </TabsList>

                    <TabsContent value="receipt" className="space-y-4">
                      {/* Receipt Preview */}
                      <Card>
                        <CardContent className="pt-6 font-mono text-sm">
                          <div className="text-center mb-4">
                            <p className="font-bold text-lg">SALES RECEIPT</p>
                            <p className="text-muted-foreground">{format(new Date(selectedReceipt.createdAt), 'PPP p')}</p>
                          </div>

                          <div className="border-t border-dashed pt-4 mb-4">
                            {selectedReceipt.items?.map((item, idx) => (
                              <div key={idx} className="flex justify-between mb-2">
                                <div>
                                  <p>{item.nameSnapshot}</p>
                                  {(item.size || item.color) && (
                                    <p className="text-xs text-muted-foreground">
                                      {item.size} {item.color}
                                    </p>
                                  )}
                                  <p className="text-xs">Qty: {item.quantity} × ${item.unitPrice.toFixed(2)}</p>
                                </div>
                                <p>${item.lineTotal.toFixed(2)}</p>
                              </div>
                            ))}
                          </div>

                          <div className="border-t border-dashed pt-4 space-y-1">
                            <div className="flex justify-between">
                              <span>Subtotal:</span>
                              <span>${selectedReceipt.subtotal.toFixed(2)}</span>
                            </div>
                            {selectedReceipt.discountTotal > 0 && (
                              <div className="flex justify-between text-red-600">
                                <span>Discount:</span>
                                <span>-${selectedReceipt.discountTotal.toFixed(2)}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span>Tax:</span>
                              <span>${selectedReceipt.taxTotal.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between font-bold text-lg border-t pt-2">
                              <span>TOTAL:</span>
                              <span>${selectedReceipt.total.toFixed(2)}</span>
                            </div>
                          </div>

                          <div className="border-t border-dashed pt-4 mt-4 text-center">
                            <p>Payment: {selectedReceipt.paymentMethod.toUpperCase()}</p>
                            {selectedReceipt.customerEmail && (
                              <p className="text-xs mt-2">{selectedReceipt.customerEmail}</p>
                            )}
                            <p className="text-xs text-muted-foreground mt-4">Thank you for your purchase!</p>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Action Buttons */}
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => setResendOpen(true)}>
                          <Send className="h-4 w-4 mr-2" />
                          Send Receipt
                        </Button>
                        <Button variant="outline" onClick={handleStartReturn}>
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Start Return
                        </Button>
                        <Button variant="outline" onClick={() => window.print()}>
                          <Printer className="h-4 w-4 mr-2" />
                          Print
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="history">
                      {selectedReceipt.emailHistory && selectedReceipt.emailHistory.length > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Sent To</TableHead>
                              <TableHead>Sent By</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Date</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedReceipt.emailHistory.map((log) => (
                              <TableRow key={log.id}>
                                <TableCell>{log.recipientEmail}</TableCell>
                                <TableCell>{log.sentByName || 'System'}</TableCell>
                                <TableCell>
                                  <Badge className={log.status === 'sent' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                                    {log.status}
                                  </Badge>
                                </TableCell>
                                <TableCell>{format(new Date(log.sentAt), 'PPp')}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>No email history</p>
                        </div>
                      )}
                    </TabsContent>

                    {selectedReceipt.returns && selectedReceipt.returns.length > 0 && (
                      <TabsContent value="returns">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Return #</TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedReceipt.returns.map((ret) => (
                              <TableRow key={ret.id}>
                                <TableCell className="font-mono">{ret.returnNumber}</TableCell>
                                <TableCell>{format(new Date(ret.createdAt), 'PPp')}</TableCell>
                                <TableCell>
                                  <Badge>{ret.status}</Badge>
                                </TableCell>
                                <TableCell className="text-right">${ret.total.toFixed(2)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TabsContent>
                    )}
                  </Tabs>
                </>
              )}
            </DialogContent>
          </Dialog>

          {/* Resend Receipt Dialog */}
          <Dialog open={resendOpen} onOpenChange={setResendOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Resend Receipt</DialogTitle>
                <DialogDescription>
                  Send a copy of this receipt to the customer's email address.
                </DialogDescription>
              </DialogHeader>

              <div>
                <Label>Email Address</Label>
                <Input
                  type="email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="customer@example.com"
                />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setResendOpen(false)}>Cancel</Button>
                <Button onClick={handleResendReceipt} disabled={!resendEmail || sending}>
                  {sending ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Send Receipt
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Start Return Dialog */}
          <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Start Return</DialogTitle>
                <DialogDescription>
                  Select items to return from this order.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Already Returned</TableHead>
                      <TableHead className="text-right">Qty to Return</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {returnableItems.map((item) => (
                      <TableRow key={item.originalOrderItemId} className={!item.canReturn ? 'opacity-50' : ''}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{item.nameSnapshot}</p>
                            {(item.size || item.color) && (
                              <p className="text-sm text-muted-foreground">{item.size} {item.color}</p>
                            )}
                            <p className="text-sm text-muted-foreground">${item.unitPrice.toFixed(2)} each</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{item.originalQuantity}</TableCell>
                        <TableCell className="text-right">{item.alreadyReturned}</TableCell>
                        <TableCell className="text-right">
                          {item.canReturn ? (
                            <Input
                              type="number"
                              min="0"
                              max={item.returnableQuantity}
                              className="w-20 text-right"
                              value={selectedReturnItems[item.originalOrderItemId] || 0}
                              onChange={(e) => setSelectedReturnItems(prev => ({
                                ...prev,
                                [item.originalOrderItemId]: Math.min(
                                  Math.max(0, parseInt(e.target.value) || 0),
                                  item.returnableQuantity
                                )
                              }))}
                            />
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div>
                  <Label>Reason for Return</Label>
                  <Select value={returnReason} onValueChange={setReturnReason}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_needed">No Longer Needed</SelectItem>
                      <SelectItem value="wrong_item">Wrong Item</SelectItem>
                      <SelectItem value="defective">Defective Product</SelectItem>
                      <SelectItem value="damaged">Damaged</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Additional Notes</Label>
                  <Input
                    value={returnNotes}
                    onChange={(e) => setReturnNotes(e.target.value)}
                    placeholder="Optional notes about the return..."
                  />
                </div>

                {/* Return Summary */}
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex justify-between font-medium">
                      <span>Estimated Refund:</span>
                      <span>
                        ${returnableItems
                          .reduce((sum, item) => 
                            sum + (selectedReturnItems[item.originalOrderItemId] || 0) * item.unitPrice, 
                            0
                          ).toFixed(2)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setReturnOpen(false)}>Cancel</Button>
                <Button onClick={handleCreateReturn} disabled={creatingReturn}>
                  {creatingReturn ? 'Creating...' : 'Create Return'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}

