import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  RotateCcw, Search, Eye, Check, X, DollarSign, Package, 
  Clock, AlertCircle, CheckCircle, XCircle, TrendingDown, Users
} from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface ReturnItem {
  id: string;
  productId: string;
  variantId?: string;
  nameSnapshot: string;
  size?: string;
  color?: string;
  originalQuantity: number;
  returnQuantity: number;
  unitPrice: number;
  lineTotal: number;
  condition: string;
  restocked: boolean;
  notes?: string;
}

interface Return {
  id: string;
  originalOrderId: string;
  returnNumber: string;
  returnType: 'return' | 'exchange' | 'void';
  status: 'pending' | 'approved' | 'completed' | 'rejected';
  customerEmail?: string;
  customerPhone?: string;
  customerId?: string;
  customerName?: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  refundMethod?: string;
  refundStatus: string;
  refundProcessedAt?: number;
  storeCreditAmount: number;
  storeCreditCode?: string;
  reasonCode?: string;
  reasonDetails?: string;
  internalNotes?: string;
  restockItems: boolean;
  restockingFee: number;
  createdByName?: string;
  approvedByName?: string;
  originalOrderTotal?: number;
  createdAt: number;
  updatedAt: number;
  items?: ReturnItem[];
}

interface ReturnStats {
  totalReturns: number;
  completedReturns: number;
  pendingReturns: number;
  rejectedReturns: number;
  totalRefunded: number;
  totalStoreCredits: number;
  uniqueCustomers: number;
}

export default function AdminReturns() {
  const [returns, setReturns] = useState<Return[]>([]);
  const [stats, setStats] = useState<ReturnStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedReturn, setSelectedReturn] = useState<Return | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'complete' | 'refund' | 'restock'>('approve');
  const [actionNotes, setActionNotes] = useState('');
  const [refundMethod, setRefundMethod] = useState<string>('original_payment');
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [processing, setProcessing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadReturns();
    loadStats();
  }, [statusFilter]);

  const loadReturns = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.append('status', statusFilter);
      }
      const response = await apiClient.get<{ success: boolean; data: Return[] }>(
        `/api/returns?${params.toString()}`
      );
      if (response.success) {
        setReturns(response.data);
      }
    } catch (error: any) {
      toast({ title: 'Error loading returns', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; data: ReturnStats }>('/api/returns/stats');
      if (response.success) {
        setStats(response.data);
      }
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const loadReturnDetails = async (returnId: string) => {
    try {
      const response = await apiClient.get<{ success: boolean; data: Return }>(`/api/returns/${returnId}`);
      if (response.success) {
        setSelectedReturn(response.data);
        setDetailsOpen(true);
      }
    } catch (error: any) {
      toast({ title: 'Error loading return details', description: error.message, variant: 'destructive' });
    }
  };

  const handleAction = async () => {
    if (!selectedReturn) return;
    
    setProcessing(true);
    try {
      if (actionType === 'refund') {
        await apiClient.post(`/api/returns/${selectedReturn.id}/process-refund`, {
          refundMethod,
          amount: refundAmount ? parseFloat(refundAmount) : undefined,
          notes: actionNotes,
        });
        toast({ title: 'Refund processed successfully' });
      } else if (actionType === 'restock') {
        await apiClient.post(`/api/returns/${selectedReturn.id}/restock`, {});
        toast({ title: 'Items restocked successfully' });
      } else {
        const newStatus = actionType === 'approve' ? 'approved' 
          : actionType === 'reject' ? 'rejected' 
          : 'completed';
        await apiClient.put(`/api/returns/${selectedReturn.id}/status`, {
          status: newStatus,
          internalNotes: actionNotes,
        });
        toast({ title: `Return ${newStatus}` });
      }
      
      setActionDialogOpen(false);
      setActionNotes('');
      loadReturns();
      loadStats();
      loadReturnDetails(selectedReturn.id);
    } catch (error: any) {
      toast({ title: 'Action failed', description: error.message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  const openActionDialog = (type: typeof actionType) => {
    setActionType(type);
    setActionNotes('');
    setRefundAmount(selectedReturn?.total.toString() || '');
    setActionDialogOpen(true);
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
    };
    return <Badge className={styles[status] || ''}>{status}</Badge>;
  };

  const getRefundStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      processed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    };
    return <Badge className={styles[status] || ''}>{status}</Badge>;
  };

  const filteredReturns = returns.filter(ret => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      ret.returnNumber.toLowerCase().includes(query) ||
      ret.customerEmail?.toLowerCase().includes(query) ||
      ret.customerName?.toLowerCase().includes(query) ||
      ret.originalOrderId.toLowerCase().includes(query)
    );
  });

  const getReasonLabel = (code?: string) => {
    const reasons: Record<string, string> = {
      defective: 'Defective Product',
      wrong_item: 'Wrong Item',
      not_needed: 'No Longer Needed',
      damaged: 'Damaged',
      other: 'Other',
    };
    return reasons[code || ''] || code || 'Not specified';
  };

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
                <RotateCcw className="h-8 w-8" />
                Returns & Refunds
              </h1>
              <p className="text-muted-foreground">Manage product returns and process refunds</p>
            </div>
          </div>

          {/* Stats Cards */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Pending
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-yellow-600">{stats.pendingReturns}</p>
                  <p className="text-xs text-muted-foreground">Awaiting review</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Completed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-green-600">{stats.completedReturns}</p>
                  <p className="text-xs text-muted-foreground">Successfully processed</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <TrendingDown className="h-4 w-4" />
                    Total Refunded
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-red-600">${stats.totalRefunded.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">Store credits: ${stats.totalStoreCredits.toFixed(2)}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Unique Customers
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{stats.uniqueCustomers}</p>
                  <p className="text-xs text-muted-foreground">With returns</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Filters */}
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-[250px]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                    <Input
                      placeholder="Search by return #, order, or customer..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Returns Table */}
          <Card>
            <CardHeader>
              <CardTitle>Returns</CardTitle>
              <CardDescription>
                {filteredReturns.length} return{filteredReturns.length !== 1 ? 's' : ''} found
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : filteredReturns.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <RotateCcw className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No returns found</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Return #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Refund Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReturns.map((ret) => (
                      <TableRow key={ret.id}>
                        <TableCell className="font-mono font-medium">{ret.returnNumber}</TableCell>
                        <TableCell>{format(new Date(ret.createdAt), 'MMM d, yyyy h:mm a')}</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{ret.customerName || 'Guest'}</p>
                            <p className="text-sm text-muted-foreground">{ret.customerEmail || 'No email'}</p>
                          </div>
                        </TableCell>
                        <TableCell className="capitalize">{ret.returnType}</TableCell>
                        <TableCell className="font-medium">${ret.total.toFixed(2)}</TableCell>
                        <TableCell>{getStatusBadge(ret.status)}</TableCell>
                        <TableCell>{getRefundStatusBadge(ret.refundStatus)}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => loadReturnDetails(ret.id)}>
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Return Details Dialog */}
          <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              {selectedReturn && (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-4">
                      Return #{selectedReturn.returnNumber}
                      {getStatusBadge(selectedReturn.status)}
                    </DialogTitle>
                    <DialogDescription>
                      Created on {format(new Date(selectedReturn.createdAt), 'PPP')}
                      {selectedReturn.createdByName && ` by ${selectedReturn.createdByName}`}
                    </DialogDescription>
                  </DialogHeader>

                  <Tabs defaultValue="details" className="mt-4">
                    <TabsList>
                      <TabsTrigger value="details">Details</TabsTrigger>
                      <TabsTrigger value="items">Items ({selectedReturn.items?.length || 0})</TabsTrigger>
                      <TabsTrigger value="actions">Actions</TabsTrigger>
                    </TabsList>

                    <TabsContent value="details" className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">Customer Information</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            <p><strong>Name:</strong> {selectedReturn.customerName || 'Guest'}</p>
                            <p><strong>Email:</strong> {selectedReturn.customerEmail || 'N/A'}</p>
                            <p><strong>Phone:</strong> {selectedReturn.customerPhone || 'N/A'}</p>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">Order Information</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            <p><strong>Original Order:</strong> {selectedReturn.originalOrderId.slice(0, 8)}...</p>
                            <p><strong>Original Total:</strong> ${selectedReturn.originalOrderTotal?.toFixed(2) || 'N/A'}</p>
                            <p><strong>Return Type:</strong> <span className="capitalize">{selectedReturn.returnType}</span></p>
                          </CardContent>
                        </Card>
                      </div>

                      <Card>
                        <CardHeader>
                          <CardTitle className="text-sm">Return Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p><strong>Reason:</strong> {getReasonLabel(selectedReturn.reasonCode)}</p>
                              {selectedReturn.reasonDetails && (
                                <p className="text-sm text-muted-foreground mt-1">{selectedReturn.reasonDetails}</p>
                              )}
                            </div>
                            <div>
                              <p><strong>Restock Items:</strong> {selectedReturn.restockItems ? 'Yes' : 'No'}</p>
                              {selectedReturn.restockingFee > 0 && (
                                <p><strong>Restocking Fee:</strong> ${selectedReturn.restockingFee.toFixed(2)}</p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle className="text-sm">Refund Information</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <p className="text-sm text-muted-foreground">Subtotal</p>
                              <p className="font-medium">${selectedReturn.subtotal.toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">Tax</p>
                              <p className="font-medium">${selectedReturn.taxTotal.toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">Total</p>
                              <p className="text-xl font-bold">${selectedReturn.total.toFixed(2)}</p>
                            </div>
                          </div>
                          <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-4">
                            <div>
                              <p><strong>Refund Method:</strong> {selectedReturn.refundMethod || 'Not set'}</p>
                              <p><strong>Refund Status:</strong> {getRefundStatusBadge(selectedReturn.refundStatus)}</p>
                            </div>
                            {selectedReturn.storeCreditCode && (
                              <div>
                                <p><strong>Store Credit Code:</strong> <span className="font-mono">{selectedReturn.storeCreditCode}</span></p>
                                <p><strong>Credit Amount:</strong> ${selectedReturn.storeCreditAmount.toFixed(2)}</p>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      {selectedReturn.internalNotes && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">Internal Notes</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="whitespace-pre-wrap">{selectedReturn.internalNotes}</p>
                          </CardContent>
                        </Card>
                      )}
                    </TabsContent>

                    <TabsContent value="items">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead>Variant</TableHead>
                            <TableHead>Condition</TableHead>
                            <TableHead className="text-right">Qty Ordered</TableHead>
                            <TableHead className="text-right">Qty Returned</TableHead>
                            <TableHead className="text-right">Unit Price</TableHead>
                            <TableHead className="text-right">Line Total</TableHead>
                            <TableHead>Restocked</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedReturn.items?.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium">{item.nameSnapshot}</TableCell>
                              <TableCell>
                                {item.size && <span className="text-sm">{item.size}</span>}
                                {item.color && <span className="text-sm"> / {item.color}</span>}
                              </TableCell>
                              <TableCell>
                                <Badge variant={item.condition === 'good' ? 'default' : 'destructive'}>
                                  {item.condition}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">{item.originalQuantity}</TableCell>
                              <TableCell className="text-right">{item.returnQuantity}</TableCell>
                              <TableCell className="text-right">${item.unitPrice.toFixed(2)}</TableCell>
                              <TableCell className="text-right">${item.lineTotal.toFixed(2)}</TableCell>
                              <TableCell>
                                {item.restocked ? (
                                  <Badge className="bg-green-100 text-green-800">Yes</Badge>
                                ) : (
                                  <Badge variant="secondary">No</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TabsContent>

                    <TabsContent value="actions" className="space-y-4">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-sm">Available Actions</CardTitle>
                          <CardDescription>
                            Take action on this return based on its current status
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-wrap gap-4">
                          {selectedReturn.status === 'pending' && (
                            <>
                              <Button onClick={() => openActionDialog('approve')} className="bg-blue-600 hover:bg-blue-700">
                                <Check className="h-4 w-4 mr-2" />
                                Approve Return
                              </Button>
                              <Button onClick={() => openActionDialog('reject')} variant="destructive">
                                <X className="h-4 w-4 mr-2" />
                                Reject Return
                              </Button>
                            </>
                          )}
                          
                          {selectedReturn.status === 'approved' && selectedReturn.refundStatus === 'pending' && (
                            <Button onClick={() => openActionDialog('refund')} className="bg-green-600 hover:bg-green-700">
                              <DollarSign className="h-4 w-4 mr-2" />
                              Process Refund
                            </Button>
                          )}

                          {selectedReturn.status === 'approved' && selectedReturn.restockItems && 
                           selectedReturn.items?.some(i => !i.restocked) && (
                            <Button onClick={() => openActionDialog('restock')} variant="outline">
                              <Package className="h-4 w-4 mr-2" />
                              Restock Items
                            </Button>
                          )}

                          {selectedReturn.status === 'approved' && selectedReturn.refundStatus === 'processed' && (
                            <Button onClick={() => openActionDialog('complete')} className="bg-green-600 hover:bg-green-700">
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Mark as Completed
                            </Button>
                          )}

                          {selectedReturn.status === 'completed' && (
                            <div className="text-green-600 flex items-center gap-2">
                              <CheckCircle className="h-5 w-5" />
                              <span>This return has been completed</span>
                            </div>
                          )}

                          {selectedReturn.status === 'rejected' && (
                            <div className="text-red-600 flex items-center gap-2">
                              <XCircle className="h-5 w-5" />
                              <span>This return was rejected</span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>
                  </Tabs>
                </>
              )}
            </DialogContent>
          </Dialog>

          {/* Action Confirmation Dialog */}
          <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {actionType === 'approve' && 'Approve Return'}
                  {actionType === 'reject' && 'Reject Return'}
                  {actionType === 'complete' && 'Complete Return'}
                  {actionType === 'refund' && 'Process Refund'}
                  {actionType === 'restock' && 'Restock Items'}
                </DialogTitle>
                <DialogDescription>
                  {actionType === 'approve' && 'Approve this return request to proceed with refund processing.'}
                  {actionType === 'reject' && 'Reject this return request. This action cannot be undone.'}
                  {actionType === 'complete' && 'Mark this return as completed.'}
                  {actionType === 'refund' && 'Process the refund for this return.'}
                  {actionType === 'restock' && 'Return the items to inventory.'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {actionType === 'refund' && (
                  <>
                    <div>
                      <Label>Refund Method</Label>
                      <Select value={refundMethod} onValueChange={setRefundMethod}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="original_payment">Original Payment Method</SelectItem>
                          <SelectItem value="store_credit">Store Credit</SelectItem>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="card">New Card</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Refund Amount</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={refundAmount}
                        onChange={(e) => setRefundAmount(e.target.value)}
                        placeholder={`Max: $${selectedReturn?.total.toFixed(2)}`}
                      />
                      <p className="text-sm text-muted-foreground mt-1">
                        Leave empty for full refund (${selectedReturn?.total.toFixed(2)})
                      </p>
                    </div>
                  </>
                )}

                <div>
                  <Label>Notes (optional)</Label>
                  <Textarea
                    value={actionNotes}
                    onChange={(e) => setActionNotes(e.target.value)}
                    placeholder="Add any notes about this action..."
                    rows={3}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setActionDialogOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleAction} 
                  disabled={processing}
                  variant={actionType === 'reject' ? 'destructive' : 'default'}
                >
                  {processing ? 'Processing...' : 'Confirm'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}

