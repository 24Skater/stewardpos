import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api-client';
import { Search, Receipt, RotateCcw, DollarSign, CreditCard, Wallet, AlertTriangle, CheckCircle2, Clock, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

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
  items: OrderItem[];
}

interface OrderItem {
  id: string;
  productId: string;
  variantId?: string;
  nameSnapshot: string;
  size?: string;
  color?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface ReturnItem extends OrderItem {
  returnQuantity: number;
  alreadyReturned: number;
  selected: boolean;
}

interface QuickReturnDialogProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

const APPROVAL_THRESHOLD = 250; // Approval needed for refunds over this amount

const reasonCodes = [
  { value: 'not_needed', label: 'No Longer Needed' },
  { value: 'wrong_item', label: 'Wrong Item' },
  { value: 'defective', label: 'Defective/Broken' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'other', label: 'Other' },
];

const refundMethods = [
  { value: 'cash', label: 'Cash', icon: DollarSign },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'store_credit', label: 'Store Credit', icon: Wallet },
];

export default function QuickReturnDialog({ open, onClose, onComplete }: QuickReturnDialogProps) {
  const { toast } = useToast();
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [existingReturns, setExistingReturns] = useState<any[]>([]);
  
  // Recent orders state
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [searchTab, setSearchTab] = useState<'recent' | 'search'>('recent');
  
  // Return state
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  const [reasonCode, setReasonCode] = useState('not_needed');
  const [reasonDetails, setReasonDetails] = useState('');
  const [refundMethod, setRefundMethod] = useState('cash');
  const [processing, setProcessing] = useState(false);
  
  // Step state
  const [step, setStep] = useState<'search' | 'select' | 'confirm'>('search');

  useEffect(() => {
    if (open) {
      loadRecentOrders();
    } else {
      resetDialog();
    }
  }, [open]);

  const loadRecentOrders = async () => {
    setLoadingRecent(true);
    try {
      const response = await apiClient.get<{ success: boolean; data: Order[] }>('/api/orders');
      if (response.success) {
        // Sort by date and take last 10
        const sorted = response.data
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 10);
        setRecentOrders(sorted);
      }
    } catch (error) {
      console.error('Failed to load recent orders:', error);
    } finally {
      setLoadingRecent(false);
    }
  };

  const resetDialog = () => {
    setSearchQuery('');
    setOrder(null);
    setReturnItems([]);
    setReasonCode('not_needed');
    setReasonDetails('');
    setRefundMethod('cash');
    setStep('search');
    setExistingReturns([]);
  };

  const selectOrder = async (orderId: string) => {
    setSearching(true);
    try {
      // Get full order details with items
      const orderResponse = await apiClient.get<{ success: boolean; data: Order }>(`/api/orders/${orderId}`);
      if (orderResponse.success) {
        setOrder(orderResponse.data);
        
        // Check for existing returns on this order
        const returnsResponse = await apiClient.get<{ success: boolean; data: Record<string, unknown>[] }>(`/api/returns/order/${orderId}`);
        if (returnsResponse.success) {
          setExistingReturns(returnsResponse.data);
        }
        
        // Calculate already returned quantities
        const alreadyReturnedMap: Record<string, number> = {};
        if (returnsResponse.success) {
          for (const ret of returnsResponse.data) {
            if (ret.items) {
              for (const item of ret.items) {
                const key = item.productId + (item.variantId || '');
                alreadyReturnedMap[key] = (alreadyReturnedMap[key] || 0) + item.returnQuantity;
              }
            }
          }
        }
        
        // Set up return items
        setReturnItems(orderResponse.data.items.map(item => {
          const key = item.productId + (item.variantId || '');
          const alreadyReturned = alreadyReturnedMap[key] || 0;
          return {
            ...item,
            returnQuantity: Math.max(0, item.quantity - alreadyReturned),
            alreadyReturned,
            selected: false,
          };
        }));
        
        setStep('select');
      }
    } catch (error: unknown) {
      toast({ title: 'Failed to load order', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setSearching(false);
    }
  };

  const searchOrder = async () => {
    if (!searchQuery.trim()) return;
    
    setSearching(true);
    try {
      // Try to find by order ID (partial match)
      const response = await apiClient.get<{ success: boolean; data: Order[] }>('/api/orders');
      
      if (response.success) {
        // Search by ID (first 8 chars typically shown on receipt)
        const foundOrder = response.data.find(o => 
          o.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          o.id.slice(0, 8).toLowerCase() === searchQuery.toLowerCase()
        );
        
        if (foundOrder) {
          await selectOrder(foundOrder.id);
        } else {
          toast({ title: 'Order not found', description: 'Please check the receipt number', variant: 'destructive' });
        }
      }
    } catch (error: unknown) {
      toast({ title: 'Search failed', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setSearching(false);
    }
  };

  const toggleItemSelection = (index: number) => {
    setReturnItems(items => items.map((item, i) => 
      i === index ? { ...item, selected: !item.selected } : item
    ));
  };

  const updateReturnQuantity = (index: number, qty: number) => {
    setReturnItems(items => items.map((item, i) => {
      if (i !== index) return item;
      const maxQty = item.quantity - item.alreadyReturned;
      return { ...item, returnQuantity: Math.min(Math.max(0, qty), maxQty) };
    }));
  };

  const getSelectedItems = () => returnItems.filter(item => item.selected && item.returnQuantity > 0);

  const calculateRefundTotal = () => {
    return getSelectedItems().reduce((sum, item) => sum + (item.unitPrice * item.returnQuantity), 0);
  };

  const needsApproval = () => {
    return refundMethod === 'cash' && calculateRefundTotal() > APPROVAL_THRESHOLD;
  };

  const processReturn = async () => {
    const selectedItems = getSelectedItems();
    if (selectedItems.length === 0) {
      toast({ title: 'No items selected', variant: 'destructive' });
      return;
    }

    setProcessing(true);
    try {
      const subtotal = calculateRefundTotal();
      const taxRate = 0; // Could get from settings
      const taxTotal = subtotal * taxRate;
      const total = subtotal + taxTotal;

      // Create return
      const returnData = {
        originalOrderId: order!.id,
        returnType: 'return',
        customerEmail: order!.customerEmail || undefined,
        customerPhone: order!.customerPhone || undefined,
        items: selectedItems.map(item => ({
          originalOrderItemId: item.id,
          productId: item.productId,
          variantId: item.variantId || undefined,
          nameSnapshot: item.nameSnapshot,
          size: item.size || undefined,
          color: item.color || undefined,
          originalQuantity: item.quantity,
          returnQuantity: item.returnQuantity,
          unitPrice: item.unitPrice,
          lineTotal: item.unitPrice * item.returnQuantity,
          condition: 'good',
        })),
        subtotal,
        taxTotal,
        total,
        refundMethod,
        reasonCode,
        reasonDetails: reasonDetails || undefined,
        restockItems: true,
        restockingFee: 0,
      };

      const createResponse = await apiClient.post<{ success: boolean; data: Record<string, unknown> }>('/api/returns', returnData);
      
      if (!createResponse.success) {
        throw new Error('Failed to create return');
      }

      const returnId = createResponse.data.id;

      // Auto-approve if under threshold for cash, or any amount for card/store credit
      const shouldAutoApprove = refundMethod !== 'cash' || total <= APPROVAL_THRESHOLD;

      if (shouldAutoApprove) {
        // Approve the return
        await apiClient.put(`/api/returns/${returnId}/status`, { status: 'approved' });
        
        // Process the refund immediately
        await apiClient.post(`/api/returns/${returnId}/process-refund`, {
          refundMethod,
          amount: total,
        });

        // Restock items
        await apiClient.post(`/api/returns/${returnId}/restock`);

        toast({
          title: 'Return processed!',
          description: `Refund of $${total.toFixed(2)} via ${refundMethod}`,
        });
      } else {
        // Needs manager approval
        toast({
          title: 'Return created - Needs approval',
          description: `Returns over $${APPROVAL_THRESHOLD} require manager approval`,
          variant: 'default',
        });
      }

      onComplete();
      onClose();
    } catch (error: unknown) {
      toast({ title: 'Failed to process return', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5" />
            Quick Return
          </DialogTitle>
          <DialogDescription>
            {step === 'search' && 'Enter the receipt number or order ID to start a return'}
            {step === 'select' && 'Select items to return'}
            {step === 'confirm' && 'Confirm return details'}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Search */}
        {step === 'search' && (
          <div className="space-y-4 py-4">
            <Tabs value={searchTab} onValueChange={(v) => setSearchTab(v as 'recent' | 'search')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="recent">
                  <Clock className="w-4 h-4 mr-2" />
                  Recent Receipts
                </TabsTrigger>
                <TabsTrigger value="search">
                  <Search className="w-4 h-4 mr-2" />
                  Search
                </TabsTrigger>
              </TabsList>

              {/* Recent Orders Tab */}
              <TabsContent value="recent" className="mt-4">
                {loadingRecent ? (
                  <div className="text-center py-8 text-muted-foreground">Loading recent orders...</div>
                ) : recentOrders.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No recent orders found</div>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {recentOrders.map((recentOrder) => (
                      <button
                        key={recentOrder.id}
                        onClick={() => selectOrder(recentOrder.id)}
                        disabled={searching}
                        className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-secondary rounded-lg">
                            <Receipt className="w-4 h-4 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-mono font-medium">#{recentOrder.id.slice(0, 8).toUpperCase()}</p>
                            <p className="text-sm text-muted-foreground">
                              {format(recentOrder.createdAt, 'MMM d, h:mm a')}
                              {recentOrder.customerEmail && ` • ${recentOrder.customerEmail}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <p className="font-bold">${recentOrder.total.toFixed(2)}</p>
                            <Badge variant="outline" className="text-xs">{recentOrder.paymentMethod}</Badge>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Manual Search Tab */}
              <TabsContent value="search" className="mt-4 space-y-4">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Enter receipt # or order ID (e.g., FCE60F0E)"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === 'Enter' && searchOrder()}
                      className="pl-9"
                    />
                  </div>
                  <Button onClick={searchOrder} disabled={searching || !searchQuery.trim()}>
                    {searching ? 'Searching...' : 'Find'}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Enter the first 8 characters of the order ID shown on the receipt
                </p>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Step 2: Select Items */}
        {step === 'select' && order && (
          <div className="space-y-4 py-4">
            {/* Order Info */}
            <div className="bg-secondary/30 p-3 rounded-lg flex justify-between items-center">
              <div>
                <p className="font-medium">Order #{order.id.slice(0, 8).toUpperCase()}</p>
                <p className="text-sm text-muted-foreground">
                  {format(order.createdAt, 'MMM d, yyyy h:mm a')} • {order.paymentMethod}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold">${order.total.toFixed(2)}</p>
                {existingReturns.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {existingReturns.length} previous return(s)
                  </Badge>
                )}
              </div>
            </div>

            {/* Items */}
            <div className="space-y-2">
              <Label>Select items to return:</Label>
              {returnItems.map((item, index) => {
                const canReturn = item.quantity - item.alreadyReturned > 0;
                return (
                  <div 
                    key={item.id} 
                    className={`flex items-center gap-3 p-3 rounded-lg border ${item.selected ? 'border-primary bg-primary/5' : 'border-border'} ${!canReturn ? 'opacity-50' : ''}`}
                  >
                    <Checkbox
                      checked={item.selected}
                      onCheckedChange={() => toggleItemSelection(index)}
                      disabled={!canReturn}
                    />
                    <div className="flex-1">
                      <p className="font-medium">{item.nameSnapshot}</p>
                      <p className="text-sm text-muted-foreground">
                        ${item.unitPrice.toFixed(2)} each
                        {item.size && ` • ${item.size}`}
                        {item.color && ` • ${item.color}`}
                      </p>
                      {item.alreadyReturned > 0 && (
                        <p className="text-xs text-orange-600">{item.alreadyReturned} already returned</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Qty:</span>
                      <Input
                        type="number"
                        min={0}
                        max={item.quantity - item.alreadyReturned}
                        value={item.returnQuantity}
                        onChange={(e) => updateReturnQuantity(index, parseInt(e.target.value) || 0)}
                        className="w-16 text-center"
                        disabled={!item.selected || !canReturn}
                      />
                      <span className="text-sm text-muted-foreground">/ {item.quantity - item.alreadyReturned}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Reason */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Reason for Return</Label>
                <Select value={reasonCode} onValueChange={setReasonCode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {reasonCodes.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Refund Method</Label>
                <Select value={refundMethod} onValueChange={setRefundMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {refundMethods.map(r => (
                      <SelectItem key={r.value} value={r.value}>
                        <div className="flex items-center gap-2">
                          <r.icon className="w-4 h-4" />
                          {r.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Additional Notes (Optional)</Label>
              <Textarea
                placeholder="Any additional details..."
                value={reasonDetails}
                onChange={(e) => setReasonDetails(e.target.value)}
                rows={2}
              />
            </div>

            {/* Refund Summary */}
            <div className="bg-secondary/30 p-4 rounded-lg space-y-2">
              <div className="flex justify-between">
                <span>Items to return:</span>
                <span>{getSelectedItems().length} item(s)</span>
              </div>
              <div className="flex justify-between text-lg font-bold">
                <span>Refund Total:</span>
                <span className="text-green-600">${calculateRefundTotal().toFixed(2)}</span>
              </div>
              {needsApproval() && (
                <div className="flex items-center gap-2 text-amber-600 text-sm mt-2">
                  <AlertTriangle className="w-4 h-4" />
                  Cash refunds over ${APPROVAL_THRESHOLD} require manager approval
                </div>
              )}
              {!needsApproval() && getSelectedItems().length > 0 && (
                <div className="flex items-center gap-2 text-green-600 text-sm mt-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Will be processed immediately
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'search' && (
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          )}
          {step === 'select' && (
            <>
              <Button variant="outline" onClick={() => setStep('search')}>
                Back
              </Button>
              <Button 
                onClick={processReturn} 
                disabled={getSelectedItems().length === 0 || processing}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {processing ? 'Processing...' : needsApproval() ? 'Submit for Approval' : `Refund $${calculateRefundTotal().toFixed(2)}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

