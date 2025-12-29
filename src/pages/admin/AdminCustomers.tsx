import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient } from '@/lib/api-client';
import { Search, Plus, Edit, Trash2, Eye, ShoppingCart, Briefcase, DollarSign, RotateCcw } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { getCurrentSession, hasPermission, type AuthSession } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';

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
  notes?: string;
  tags: string[];
  lifetimeValue: number;
  lastOrderAt?: number;
  createdAt: number;
  updatedAt: number;
}

interface Order {
  id: string;
  createdAt: number;
  total: number;
  taxTotal: number;
  paymentMethod: string;
  items: { nameSnapshot: string; quantity: number; lineTotal: number }[];
}

interface Quote {
  id: string;
  createdAt: number;
  status: string;
  total: number;
  items: { description: string; quantity: number; lineTotal: number }[];
}

interface Return {
  id: string;
  returnNumber: string;
  returnType: string;
  status: string;
  refundStatus: string;
  refundMethod?: string;
  total: number;
  reasonCode?: string;
  createdAt: number;
}

const emptyCustomer: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  org: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  country: '',
  notes: '',
  tags: [],
  lifetimeValue: 0,
};

export default function AdminCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AuthSession | null>(null);
  
  // Dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Partial<Customer> | null>(null);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  
  // Order history
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [customerQuotes, setCustomerQuotes] = useState<Quote[]>([]);
  const [customerReturns, setCustomerReturns] = useState<Return[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  const { toast } = useToast();

  useEffect(() => {
    const loadSession = async () => {
      const currentSession = await getCurrentSession();
      setSession(currentSession);
    };
    loadSession();
  }, []);

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<{ success: boolean; data: Customer[] }>('/api/customers');
      if (response.success) {
        const customersWithDefaults = response.data.map(c => ({
          ...c,
          tags: c.tags || [],
          lifetimeValue: c.lifetimeValue || 0,
        }));
        setCustomers(customersWithDefaults.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load customers',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadCustomerHistory = async (customer: Customer) => {
    try {
      setLoadingHistory(true);
      setCustomerOrders([]);
      setCustomerQuotes([]);
      setCustomerReturns([]);

      // Load quotes
      const quotesResponse = await apiClient.get<{ success: boolean; data: Quote[] }>(`/api/quotes/customer/${customer.id}`);
      if (quotesResponse.success) {
        setCustomerQuotes(quotesResponse.data);
      }

      // Load returns by customer ID
      const returnsResponse = await apiClient.get<{ success: boolean; data: Return[] }>(`/api/returns/customer/${customer.id}`);
      if (returnsResponse.success) {
        setCustomerReturns(returnsResponse.data);
      }

      // Load orders by email if customer has an email
      if (customer.email) {
        const ordersResponse = await apiClient.get<{ success: boolean; data: Order[] }>(
          `/api/orders/customer/${encodeURIComponent(customer.email)}`
        );
        if (ordersResponse.success) {
          setCustomerOrders(ordersResponse.data);
        }
      }
    } catch (error: any) {
      console.error('Error loading customer history:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase()) ||
    c.org?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.toLowerCase().includes(search.toLowerCase())
  );

  const canWrite = hasPermission(session, 'customers', 'write');
  const canDelete = hasPermission(session, 'customers', 'delete');

  const handleAddCustomer = () => {
    setEditingCustomer({ ...emptyCustomer });
    setIsNewCustomer(true);
    setEditDialogOpen(true);
  };

  const handleEditCustomer = (customer: Customer) => {
    setEditingCustomer({ ...customer });
    setIsNewCustomer(false);
    setEditDialogOpen(true);
  };

  const handleViewCustomer = (customer: Customer) => {
    setViewingCustomer(customer);
    setViewDialogOpen(true);
    loadCustomerHistory(customer);
  };

  const handleSaveCustomer = async () => {
    if (!editingCustomer || !editingCustomer.name) {
      toast({
        title: 'Error',
        description: 'Customer name is required',
        variant: 'destructive',
      });
      return;
    }

    try {
      const payload = {
        name: editingCustomer.name,
        org: editingCustomer.org || undefined,
        email: editingCustomer.email || undefined,
        phone: editingCustomer.phone || undefined,
        address: editingCustomer.address || undefined,
        city: editingCustomer.city || undefined,
        state: editingCustomer.state || undefined,
        zip: editingCustomer.zip || undefined,
        country: editingCustomer.country || undefined,
        notes: editingCustomer.notes || undefined,
      };

      if (isNewCustomer) {
        const response = await apiClient.post<{ success: boolean; data: Customer }>('/api/customers', payload);
        if (response.success) {
          toast({ title: 'Customer created successfully' });
        }
      } else {
        const response = await apiClient.put<{ success: boolean; data: Customer }>(`/api/customers/${editingCustomer.id}`, payload);
        if (response.success) {
          toast({ title: 'Customer updated successfully' });
        }
      }

      setEditDialogOpen(false);
      setEditingCustomer(null);
      setIsNewCustomer(false);
      await loadCustomers();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save customer',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!confirm('Are you sure you want to delete this customer?')) return;

    try {
      const response = await apiClient.delete<{ success: boolean }>(`/api/customers/${id}`);
      if (response.success) {
        toast({ title: 'Customer deleted successfully' });
        await loadCustomers();
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete customer',
        variant: 'destructive',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      draft: 'outline',
      sent: 'secondary',
      accepted: 'default',
      completed: 'default',
      rejected: 'destructive',
      cancelled: 'destructive',
    };
    return <Badge variant={variants[status] || 'outline'}>{status}</Badge>;
  };

  // Calculate customer stats
  const getCustomerStats = () => {
    const totalPOSSales = customerOrders.reduce((sum, o) => sum + o.total, 0);
    const totalServiceRevenue = customerQuotes
      .filter(q => q.status === 'completed')
      .reduce((sum, q) => sum + q.total, 0);
    const totalReturns = customerReturns
      .filter(r => r.status === 'completed')
      .reduce((sum, r) => sum + r.total, 0);
    return {
      totalPOSSales,
      totalServiceRevenue,
      totalReturns,
      totalOrders: customerOrders.length,
      totalQuotes: customerQuotes.length,
      returnCount: customerReturns.length,
      totalValue: totalPOSSales + totalServiceRevenue - totalReturns,
    };
  };

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Customers</h1>
              <p className="text-muted-foreground">Manage customer relationships</p>
            </div>
            {canWrite && (
              <Button onClick={handleAddCustomer}>
                <Plus className="w-4 h-4 mr-2" />
                Add Customer
              </Button>
            )}
          </div>

          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search customers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="bg-card rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      Loading customers...
                    </TableCell>
                  </TableRow>
                ) : filteredCustomers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No customers found. {canWrite && 'Click "Add Customer" to create one.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCustomers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium">{customer.name}</TableCell>
                      <TableCell>{customer.org || '—'}</TableCell>
                      <TableCell>{customer.email || '—'}</TableCell>
                      <TableCell>{customer.phone || '—'}</TableCell>
                      <TableCell>
                        {customer.city && customer.state 
                          ? `${customer.city}, ${customer.state}` 
                          : customer.city || customer.state || '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleViewCustomer(customer)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          {canWrite && (
                            <Button variant="ghost" size="icon" onClick={() => handleEditCustomer(customer)}>
                              <Edit className="w-4 h-4" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button variant="ghost" size="icon" onClick={() => handleDeleteCustomer(customer.id)}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Add/Edit Customer Dialog */}
          <Dialog open={editDialogOpen} onOpenChange={(open) => {
            setEditDialogOpen(open);
            if (!open) {
              setEditingCustomer(null);
              setIsNewCustomer(false);
            }
          }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{isNewCustomer ? 'Add Customer' : 'Edit Customer'}</DialogTitle>
                <DialogDescription>
                  {isNewCustomer ? 'Create a new customer record' : 'Update customer information'}
                </DialogDescription>
              </DialogHeader>
              {editingCustomer && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Name *</Label>
                      <Input
                        id="name"
                        value={editingCustomer.name || ''}
                        onChange={(e) => setEditingCustomer({ ...editingCustomer, name: e.target.value })}
                        placeholder="John Doe"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="org">Organization</Label>
                      <Input
                        id="org"
                        value={editingCustomer.org || ''}
                        onChange={(e) => setEditingCustomer({ ...editingCustomer, org: e.target.value })}
                        placeholder="Company Inc."
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={editingCustomer.email || ''}
                        onChange={(e) => setEditingCustomer({ ...editingCustomer, email: e.target.value })}
                        placeholder="john@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input
                        id="phone"
                        type="tel"
                        value={editingCustomer.phone || ''}
                        onChange={(e) => setEditingCustomer({ ...editingCustomer, phone: e.target.value })}
                        placeholder="(555) 123-4567"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Input
                      id="address"
                      value={editingCustomer.address || ''}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, address: e.target.value })}
                      placeholder="123 Main St"
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={editingCustomer.city || ''}
                        onChange={(e) => setEditingCustomer({ ...editingCustomer, city: e.target.value })}
                        placeholder="New York"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="state">State</Label>
                      <Input
                        id="state"
                        value={editingCustomer.state || ''}
                        onChange={(e) => setEditingCustomer({ ...editingCustomer, state: e.target.value })}
                        placeholder="NY"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="zip">ZIP</Label>
                      <Input
                        id="zip"
                        value={editingCustomer.zip || ''}
                        onChange={(e) => setEditingCustomer({ ...editingCustomer, zip: e.target.value })}
                        placeholder="10001"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="country">Country</Label>
                      <Input
                        id="country"
                        value={editingCustomer.country || ''}
                        onChange={(e) => setEditingCustomer({ ...editingCustomer, country: e.target.value })}
                        placeholder="USA"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea
                      id="notes"
                      value={editingCustomer.notes || ''}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, notes: e.target.value })}
                      placeholder="Additional notes about this customer..."
                      rows={3}
                    />
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveCustomer}>
                  {isNewCustomer ? 'Create Customer' : 'Save Changes'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* View Customer Dialog with Order History */}
          <Dialog open={viewDialogOpen} onOpenChange={(open) => {
            setViewDialogOpen(open);
            if (!open) {
              setViewingCustomer(null);
              setCustomerOrders([]);
              setCustomerQuotes([]);
            }
          }}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Customer Details</DialogTitle>
                <DialogDescription>View customer information and order history</DialogDescription>
              </DialogHeader>
              {viewingCustomer && (
                <Tabs defaultValue="info" className="space-y-4">
                  <TabsList>
                    <TabsTrigger value="info">Info</TabsTrigger>
                    <TabsTrigger value="orders" className="flex items-center gap-2">
                      <ShoppingCart className="w-4 h-4" />
                      POS Orders ({customerOrders.length})
                    </TabsTrigger>
                    <TabsTrigger value="services" className="flex items-center gap-2">
                      <Briefcase className="w-4 h-4" />
                      Service Quotes ({customerQuotes.length})
                    </TabsTrigger>
                    <TabsTrigger value="returns" className="flex items-center gap-2">
                      <RotateCcw className="w-4 h-4" />
                      Returns ({customerReturns.length})
                    </TabsTrigger>
                  </TabsList>

                  {/* Customer Info Tab */}
                  <TabsContent value="info" className="space-y-4">
                    {/* Stats Cards */}
                    <div className="grid grid-cols-4 gap-4">
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm text-muted-foreground">POS Sales</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold">${getCustomerStats().totalPOSSales.toFixed(2)}</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm text-muted-foreground">Service Revenue</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold">${getCustomerStats().totalServiceRevenue.toFixed(2)}</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm text-muted-foreground">Returns</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold text-red-600">-${getCustomerStats().totalReturns.toFixed(2)}</div>
                          <p className="text-xs text-muted-foreground">{getCustomerStats().returnCount} return(s)</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm text-muted-foreground">Net Value</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold text-green-600">${getCustomerStats().totalValue.toFixed(2)}</div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Customer Details */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Name</label>
                        <p className="font-medium">{viewingCustomer.name}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Organization</label>
                        <p>{viewingCustomer.org || '—'}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Email</label>
                        <p>{viewingCustomer.email || '—'}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Phone</label>
                        <p>{viewingCustomer.phone || '—'}</p>
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Address</label>
                      <p>
                        {viewingCustomer.address && <span>{viewingCustomer.address}<br/></span>}
                        {viewingCustomer.city && viewingCustomer.state 
                          ? `${viewingCustomer.city}, ${viewingCustomer.state} ${viewingCustomer.zip || ''}`
                          : viewingCustomer.city || viewingCustomer.state || '—'}
                        {viewingCustomer.country && <span><br/>{viewingCustomer.country}</span>}
                      </p>
                    </div>

                    {viewingCustomer.notes && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Notes</label>
                        <p className="text-sm">{viewingCustomer.notes}</p>
                      </div>
                    )}
                  </TabsContent>

                  {/* POS Orders Tab */}
                  <TabsContent value="orders">
                    {loadingHistory ? (
                      <p className="text-center py-8 text-muted-foreground">Loading order history...</p>
                    ) : customerOrders.length === 0 ? (
                      <p className="text-center py-8 text-muted-foreground">No POS orders found for this customer</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Items</TableHead>
                            <TableHead>Payment</TableHead>
                            <TableHead>Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {customerOrders.map((order) => (
                            <TableRow key={order.id}>
                              <TableCell>{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                              <TableCell>
                                {order.items?.slice(0, 2).map((item, idx) => (
                                  <div key={idx} className="text-sm">
                                    {item.quantity}x {item.nameSnapshot}
                                  </div>
                                ))}
                                {order.items?.length > 2 && (
                                  <span className="text-xs text-muted-foreground">
                                    +{order.items.length - 2} more
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="capitalize">{order.paymentMethod}</TableCell>
                              <TableCell className="font-bold">${order.total.toFixed(2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </TabsContent>

                  {/* Service Quotes Tab */}
                  <TabsContent value="services">
                    {loadingHistory ? (
                      <p className="text-center py-8 text-muted-foreground">Loading service history...</p>
                    ) : customerQuotes.length === 0 ? (
                      <p className="text-center py-8 text-muted-foreground">No service quotes found for this customer</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Services</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {customerQuotes.map((quote) => (
                            <TableRow key={quote.id}>
                              <TableCell>{new Date(quote.createdAt).toLocaleDateString()}</TableCell>
                              <TableCell>
                                {quote.items?.slice(0, 2).map((item, idx) => (
                                  <div key={idx} className="text-sm">
                                    {item.quantity}x {item.description}
                                  </div>
                                ))}
                                {quote.items?.length > 2 && (
                                  <span className="text-xs text-muted-foreground">
                                    +{quote.items.length - 2} more
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>{getStatusBadge(quote.status)}</TableCell>
                              <TableCell className="font-bold">${quote.total.toFixed(2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </TabsContent>

                  {/* Returns Tab */}
                  <TabsContent value="returns">
                    {loadingHistory ? (
                      <p className="text-center py-8 text-muted-foreground">Loading return history...</p>
                    ) : customerReturns.length === 0 ? (
                      <p className="text-center py-8 text-muted-foreground">No returns found for this customer</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Return #</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Refund</TableHead>
                            <TableHead>Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {customerReturns.map((ret) => (
                            <TableRow key={ret.id}>
                              <TableCell>{new Date(ret.createdAt).toLocaleDateString()}</TableCell>
                              <TableCell className="font-mono text-sm">{ret.returnNumber}</TableCell>
                              <TableCell className="capitalize">{ret.returnType}</TableCell>
                              <TableCell>
                                <Badge className={
                                  ret.status === 'completed' ? 'bg-green-100 text-green-800' :
                                  ret.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                  ret.status === 'rejected' ? 'bg-red-100 text-red-800' :
                                  'bg-blue-100 text-blue-800'
                                }>
                                  {ret.status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={
                                  ret.refundStatus === 'processed' ? 'border-green-500 text-green-700' :
                                  'border-yellow-500 text-yellow-700'
                                }>
                                  {ret.refundStatus}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-bold text-red-600">-${ret.total.toFixed(2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </TabsContent>
                </Tabs>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
                  Close
                </Button>
                {canWrite && viewingCustomer && (
                  <Button onClick={() => {
                    setViewDialogOpen(false);
                    handleEditCustomer(viewingCustomer);
                  }}>
                    Edit Customer
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
