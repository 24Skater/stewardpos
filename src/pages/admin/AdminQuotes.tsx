import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiClient } from '@/lib/api-client';
import { Search, Eye, Send, CheckCircle, XCircle, Clock, FileText, DollarSign, Trash2 } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';

interface QuoteItem {
  id: string;
  serviceId?: string;
  serviceName?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface Quote {
  id: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'completed' | 'cancelled';
  subtotal: number;
  taxTotal: number;
  total: number;
  notes?: string;
  createdAt: number;
  expiresAt?: number;
  items: QuoteItem[];
}

const STATUS_CONFIG = {
  draft: { label: 'Draft', variant: 'outline' as const, icon: FileText, color: 'text-gray-500' },
  sent: { label: 'Sent', variant: 'secondary' as const, icon: Send, color: 'text-blue-500' },
  accepted: { label: 'Accepted', variant: 'default' as const, icon: CheckCircle, color: 'text-green-500' },
  rejected: { label: 'Rejected', variant: 'destructive' as const, icon: XCircle, color: 'text-red-500' },
  completed: { label: 'Completed', variant: 'default' as const, icon: CheckCircle, color: 'text-emerald-600' },
  cancelled: { label: 'Cancelled', variant: 'destructive' as const, icon: XCircle, color: 'text-gray-400' },
};

const WORKFLOW_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['accepted', 'rejected', 'cancelled'],
  accepted: ['completed', 'cancelled'],
  rejected: [],
  completed: [],
  cancelled: [],
};

export default function AdminQuotes() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadQuotes();
  }, []);

  const loadQuotes = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<{ success: boolean; data: Quote[] }>('/api/quotes');
      if (response.success) {
        setQuotes(response.data);
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load quotes',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (quoteId: string, newStatus: string) => {
    try {
      const response = await apiClient.put<{ success: boolean; data: Quote }>(
        `/api/quotes/${quoteId}/status`,
        { status: newStatus }
      );
      
      if (response.success) {
        toast({ title: `Quote status updated to ${STATUS_CONFIG[newStatus as keyof typeof STATUS_CONFIG].label}` });
        await loadQuotes();
        
        // Update selected quote if viewing
        if (selectedQuote?.id === quoteId) {
          setSelectedQuote(response.data);
        }
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update status',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteQuote = async (quoteId: string) => {
    if (!confirm('Are you sure you want to delete this quote?')) return;
    
    try {
      const response = await apiClient.delete<{ success: boolean }>(`/api/quotes/${quoteId}`);
      if (response.success) {
        toast({ title: 'Quote deleted successfully' });
        setViewDialogOpen(false);
        await loadQuotes();
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete quote',
        variant: 'destructive',
      });
    }
  };

  const filteredQuotes = quotes.filter(q => {
    const matchesSearch = 
      q.customerName?.toLowerCase().includes(search.toLowerCase()) ||
      q.customerEmail?.toLowerCase().includes(search.toLowerCase()) ||
      q.id.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || q.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: Quote['status']) => {
    const config = STATUS_CONFIG[status];
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getQuoteCounts = () => {
    const counts = { draft: 0, sent: 0, accepted: 0, completed: 0, rejected: 0, cancelled: 0 };
    quotes.forEach(q => { counts[q.status]++; });
    return counts;
  };

  const counts = getQuoteCounts();

  const getNextActions = (quote: Quote) => {
    const transitions = WORKFLOW_TRANSITIONS[quote.status] || [];
    return transitions.map(status => ({
      status,
      ...STATUS_CONFIG[status as keyof typeof STATUS_CONFIG],
    }));
  };

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Quotes</h1>
              <p className="text-muted-foreground">Manage service quotes and orders</p>
            </div>
          </div>

          {/* Status Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            {Object.entries(STATUS_CONFIG).map(([status, config]) => {
              const Icon = config.icon;
              const count = counts[status as keyof typeof counts];
              return (
                <Card 
                  key={status} 
                  className={`cursor-pointer transition-all ${statusFilter === status ? 'ring-2 ring-primary' : ''}`}
                  onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <Icon className={`w-5 h-5 ${config.color}`} />
                    <div>
                      <p className="text-2xl font-bold">{count}</p>
                      <p className="text-xs text-muted-foreground">{config.label}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Filters */}
          <div className="flex gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by customer or quote ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                  <SelectItem key={status} value={status}>{config.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quotes Table */}
          <div className="bg-card rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quote ID</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      Loading quotes...
                    </TableCell>
                  </TableRow>
                ) : filteredQuotes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No quotes found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredQuotes.map((quote) => (
                    <TableRow key={quote.id}>
                      <TableCell className="font-mono text-sm">{quote.id.slice(0, 8)}...</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{quote.customerName || 'Walk-in'}</p>
                          <p className="text-xs text-muted-foreground">{quote.customerEmail || '—'}</p>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(quote.status)}</TableCell>
                      <TableCell>{quote.items?.length || 0} items</TableCell>
                      <TableCell className="font-bold">${quote.total.toFixed(2)}</TableCell>
                      <TableCell>{new Date(quote.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => {
                              setSelectedQuote(quote);
                              setViewDialogOpen(true);
                            }}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {getNextActions(quote).length > 0 && (
                            <Select onValueChange={(status) => handleStatusChange(quote.id, status)}>
                              <SelectTrigger className="w-32 h-8">
                                <SelectValue placeholder="Action..." />
                              </SelectTrigger>
                              <SelectContent>
                                {getNextActions(quote).map(action => {
                                  const Icon = action.icon;
                                  return (
                                    <SelectItem key={action.status} value={action.status}>
                                      <span className="flex items-center gap-2">
                                        <Icon className={`w-3 h-3 ${action.color}`} />
                                        {action.label}
                                      </span>
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Quote Detail Dialog */}
          <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  Quote Details
                  {selectedQuote && getStatusBadge(selectedQuote.status)}
                </DialogTitle>
                <DialogDescription>
                  Quote ID: {selectedQuote?.id}
                </DialogDescription>
              </DialogHeader>
              
              {selectedQuote && (
                <Tabs defaultValue="details" className="space-y-4">
                  <TabsList>
                    <TabsTrigger value="details">Details</TabsTrigger>
                    <TabsTrigger value="items">Items ({selectedQuote.items?.length || 0})</TabsTrigger>
                    <TabsTrigger value="workflow">Workflow</TabsTrigger>
                  </TabsList>

                  <TabsContent value="details" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm text-muted-foreground">Customer</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="font-medium">{selectedQuote.customerName || 'Walk-in'}</p>
                          <p className="text-sm text-muted-foreground">{selectedQuote.customerEmail || '—'}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm text-muted-foreground">Created</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="font-medium">{new Date(selectedQuote.createdAt).toLocaleDateString()}</p>
                          <p className="text-sm text-muted-foreground">
                            {new Date(selectedQuote.createdAt).toLocaleTimeString()}
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                          <DollarSign className="w-4 h-4" />
                          Totals
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex justify-between">
                          <span>Subtotal</span>
                          <span>${selectedQuote.subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Tax</span>
                          <span>${selectedQuote.taxTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-lg font-bold border-t pt-2">
                          <span>Total</span>
                          <span>${selectedQuote.total.toFixed(2)}</span>
                        </div>
                      </CardContent>
                    </Card>

                    {selectedQuote.notes && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm text-muted-foreground">Notes</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm">{selectedQuote.notes}</p>
                        </CardContent>
                      </Card>
                    )}
                  </TabsContent>

                  <TabsContent value="items">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Description</TableHead>
                          <TableHead>Qty</TableHead>
                          <TableHead>Unit Price</TableHead>
                          <TableHead>Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedQuote.items?.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>
                              <p className="font-medium">{item.description}</p>
                              {item.serviceName && (
                                <p className="text-xs text-muted-foreground">{item.serviceName}</p>
                              )}
                            </TableCell>
                            <TableCell>{item.quantity}</TableCell>
                            <TableCell>${item.unitPrice.toFixed(2)}</TableCell>
                            <TableCell className="font-bold">${item.lineTotal.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TabsContent>

                  <TabsContent value="workflow" className="space-y-4">
                    <div className="flex items-center gap-4 p-4 bg-secondary/50 rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium">Current Status</p>
                        <div className="flex items-center gap-2 mt-1">
                          {getStatusBadge(selectedQuote.status)}
                        </div>
                      </div>
                    </div>

                    {/* Workflow Diagram */}
                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      {['draft', 'sent', 'accepted', 'completed'].map((status, idx) => {
                        const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG];
                        const Icon = config.icon;
                        const isActive = selectedQuote.status === status;
                        const isPast = ['draft', 'sent', 'accepted', 'completed'].indexOf(selectedQuote.status) > idx;
                        
                        return (
                          <div key={status} className="flex items-center">
                            <div className={`flex flex-col items-center ${isActive ? 'opacity-100' : isPast ? 'opacity-60' : 'opacity-30'}`}>
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isActive ? 'bg-primary text-primary-foreground' : isPast ? 'bg-green-500 text-white' : 'bg-muted'}`}>
                                <Icon className="w-5 h-5" />
                              </div>
                              <p className="text-xs mt-1">{config.label}</p>
                            </div>
                            {idx < 3 && (
                              <div className={`w-12 h-0.5 mx-2 ${isPast ? 'bg-green-500' : 'bg-muted'}`} />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Available Actions */}
                    {getNextActions(selectedQuote).length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Available Actions</p>
                        <div className="flex gap-2 flex-wrap">
                          {getNextActions(selectedQuote).map(action => {
                            const Icon = action.icon;
                            return (
                              <Button
                                key={action.status}
                                variant={action.status === 'cancelled' ? 'destructive' : 'default'}
                                onClick={() => handleStatusChange(selectedQuote.id, action.status)}
                              >
                                <Icon className="w-4 h-4 mr-2" />
                                Mark as {action.label}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Rejected/Cancelled states */}
                    {(selectedQuote.status === 'rejected' || selectedQuote.status === 'cancelled') && (
                      <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                        <p className="text-sm text-destructive">
                          This quote has been {selectedQuote.status}. No further actions available.
                        </p>
                      </div>
                    )}

                    {selectedQuote.status === 'completed' && (
                      <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                        <p className="text-sm text-green-600">
                          ✓ This quote has been completed successfully.
                        </p>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              )}

              <DialogFooter className="flex justify-between">
                <Button 
                  variant="destructive" 
                  onClick={() => selectedQuote && handleDeleteQuote(selectedQuote.id)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Quote
                </Button>
                <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}

