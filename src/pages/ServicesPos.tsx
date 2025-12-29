import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiClient } from '@/lib/api-client';
import { QuoteItem } from '@/lib/db';
import { Search, Plus, UserPlus, ShoppingCart, Calendar, MapPin, Clock, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';

interface Service {
  id: string;
  name: string;
  category: string;
  description?: string;
  basePrice?: number;
  unitType: string;
  isActive: boolean;
}

interface Customer {
  id: string;
  name: string;
  org?: string;
  email?: string;
  phone?: string;
}

interface ServiceCartItem extends QuoteItem {
  serviceName: string;
  details: Record<string, string>;
}

export default function ServicesPos() {
  const [services, setServices] = useState<Service[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [cart, setCart] = useState<ServiceCartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [serviceDetailsOpen, setServiceDetailsOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [serviceDetails, setServiceDetails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [servicesResponse, customersResponse] = await Promise.all([
        apiClient.get<{ success: boolean; data: Service[] }>('/api/services'),
        apiClient.get<{ success: boolean; data: Customer[] }>('/api/customers'),
      ]);

      if (servicesResponse.success) {
        setServices(servicesResponse.data.filter(s => s.isActive));
      }
      if (customersResponse.success) {
        setCustomers(customersResponse.data);
      }
    } catch (error: any) {
      toast({
        title: 'Error loading data',
        description: error.message || 'Failed to load services and customers',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredServices = services.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleServiceClick = (service: Service) => {
    setSelectedService(service);
    setServiceDetails({});
    setServiceDetailsOpen(true);
  };

  const handleAddToCart = () => {
    if (!selectedService) return;

    const cartItem: ServiceCartItem = {
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      name: selectedService.name,
      quantity: 1,
      unitPrice: selectedService.basePrice || 0,
      details: serviceDetails,
    };

    setCart([...cart, cartItem]);
    setServiceDetailsOpen(false);
    toast({ title: `${selectedService.name} added to quote` });
  };

  const handleRemoveFromCart = (index: number) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  const handleCreateCustomer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    try {
      const response = await apiClient.post<{ success: boolean; data: Customer }>('/api/customers', {
        name: formData.get('name') as string,
        email: formData.get('email') as string,
        phone: formData.get('phone') as string,
        org: formData.get('org') as string,
      });

      if (response.success) {
        setCustomers([...customers, response.data]);
        setSelectedCustomer(response.data);
        setNewCustomerOpen(false);
        toast({ title: 'Customer created' });
      }
    } catch (error: any) {
      toast({
        title: 'Error creating customer',
        description: error.message || 'Failed to create customer',
        variant: 'destructive',
      });
    }
  };

  const handleCreateQuote = async () => {
    if (!selectedCustomer || cart.length === 0) {
      toast({ title: 'Please select customer and add services', variant: 'destructive' });
      return;
    }

    const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const taxRate = 0.08;
    const taxTotal = subtotal * taxRate;
    const total = subtotal + taxTotal;

    try {
      const quoteData = {
        customerId: selectedCustomer.id,
        items: cart.map(item => ({
          serviceId: item.serviceId,
          description: `${item.serviceName}${Object.keys(item.details).length > 0 ? ' - ' + Object.entries(item.details).map(([k, v]) => `${k}: ${v}`).join(', ') : ''}`,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.unitPrice * item.quantity,
        })),
        subtotal,
        taxTotal,
        total,
        status: 'draft',
        notes: '',
      };

      const response = await apiClient.post<{ success: boolean; data: any }>('/api/quotes', quoteData);
      
      if (response.success) {
        toast({ 
          title: 'Quote created successfully',
          description: `Total: $${total.toFixed(2)}`,
        });
        setCart([]);
        setSelectedCustomer(null);
      }
    } catch (error: any) {
      toast({ 
        title: 'Error creating quote',
        description: error.message || 'Failed to create quote',
        variant: 'destructive',
      });
    }
  };

  const getServiceFields = (service: Service) => {
    const commonFields = [
      { key: 'date', label: 'Date', type: 'date', icon: Calendar },
      { key: 'time', label: 'Time', type: 'time', icon: Clock },
      { key: 'location', label: 'Location', type: 'text', icon: MapPin },
    ];

    const categoryFields: Record<string, any[]> = {
      'Audio': [
        ...commonFields,
        { key: 'duration', label: 'Duration (hours)', type: 'number' },
        { key: 'attendees', label: 'Expected Attendees', type: 'number' },
        { key: 'equipment', label: 'Special Equipment Needed', type: 'textarea' },
      ],
      'Media': [
        ...commonFields,
        { key: 'duration', label: 'Duration (hours)', type: 'number' },
        { key: 'deliverables', label: 'Deliverables', type: 'textarea' },
        { key: 'stylePreference', label: 'Style Preference', type: 'text' },
      ],
    };

    return categoryFields[service.category] || commonFields;
  };

  const totalAmount = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const taxAmount = totalAmount * 0.08;
  const grandTotal = totalAmount + taxAmount;

  if (loading) {
    return (
      <div className="flex flex-col h-screen bg-background items-center justify-center">
        <p className="text-muted-foreground">Loading services...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">Services POS</h1>
              <p className="text-xs text-muted-foreground">Create quotes and book services</p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Main Content */}
        <div className="flex-1 flex flex-col p-6 overflow-auto">
          {/* Customer Selection */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">Customer</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <Select
                  value={selectedCustomer?.id}
                  onValueChange={(id) => {
                    const customer = customers.find(c => c.id === id);
                    setSelectedCustomer(customer || null);
                  }}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select customer..." />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map(customer => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name} {customer.email ? `(${customer.email})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={() => setNewCustomerOpen(true)}>
                  <UserPlus className="w-4 h-4 mr-2" />
                  New Customer
                </Button>
              </div>
              {selectedCustomer && (
                <div className="mt-4 p-4 bg-secondary/50 rounded-lg">
                  <p className="font-medium">{selectedCustomer.name}</p>
                  {selectedCustomer.org && <p className="text-sm text-muted-foreground">{selectedCustomer.org}</p>}
                  <p className="text-sm text-muted-foreground">{selectedCustomer.email}</p>
                  <p className="text-sm text-muted-foreground">{selectedCustomer.phone}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Search */}
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search services..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Services Grid */}
          {filteredServices.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No services available.</p>
              <p className="text-sm">Create services in the admin panel to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredServices.map((service) => (
                <Card 
                  key={service.id} 
                  className="cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => handleServiceClick(service)}
                >
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <CardTitle className="text-base">{service.name}</CardTitle>
                      <Badge variant="secondary">{service.category}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-3">{service.description}</p>
                    {service.basePrice && (
                      <p className="text-lg font-bold text-primary">
                        ${service.basePrice.toFixed(2)}
                        {service.unitType && <span className="text-xs text-muted-foreground">/{service.unitType}</span>}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Cart Sidebar */}
        <div className="w-96 border-l border-border bg-card p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <ShoppingCart className="w-5 h-5" />
            <h2 className="text-lg font-bold">Quote ({cart.length})</h2>
          </div>

          <div className="flex-1 overflow-auto space-y-3">
            {cart.map((item, index) => (
              <Card key={index}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <p className="font-medium">{item.serviceName}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFromCart(index)}
                    >
                      ×
                    </Button>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    {Object.entries(item.details).map(([key, value]) => (
                      <p key={key}>
                        <span className="capitalize">{key}:</span> {value}
                      </p>
                    ))}
                  </div>
                  <p className="text-right font-bold mt-2">${item.unitPrice.toFixed(2)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="border-t border-border pt-4 mt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span>
              <span>${totalAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Tax (8%)</span>
              <span>${taxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>${grandTotal.toFixed(2)}</span>
            </div>
            <Button 
              className="w-full mt-4" 
              onClick={handleCreateQuote}
              disabled={!selectedCustomer || cart.length === 0}
            >
              Create Quote
            </Button>
          </div>
        </div>
      </div>

      {/* New Customer Dialog */}
      <Dialog open={newCustomerOpen} onOpenChange={setNewCustomerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Customer</DialogTitle>
            <DialogDescription>Add a new customer to the system</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCustomer}>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input id="name" name="name" required />
              </div>
              <div>
                <Label htmlFor="org">Organization</Label>
                <Input id="org" name="org" />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" type="tel" />
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setNewCustomerOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Create Customer</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Service Details Dialog */}
      <Dialog open={serviceDetailsOpen} onOpenChange={setServiceDetailsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedService?.name}</DialogTitle>
            <DialogDescription>{selectedService?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-96 overflow-auto">
            {selectedService && getServiceFields(selectedService).map((field) => {
              const Icon = field.icon;
              return (
                <div key={field.key}>
                  <Label htmlFor={field.key} className="flex items-center gap-2">
                    {Icon && <Icon className="w-4 h-4" />}
                    {field.label}
                  </Label>
                  {field.type === 'textarea' ? (
                    <Textarea
                      id={field.key}
                      value={serviceDetails[field.key] || ''}
                      onChange={(e) => setServiceDetails({ ...serviceDetails, [field.key]: e.target.value })}
                    />
                  ) : (
                    <Input
                      id={field.key}
                      type={field.type}
                      value={serviceDetails[field.key] || ''}
                      onChange={(e) => setServiceDetails({ ...serviceDetails, [field.key]: e.target.value })}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setServiceDetailsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddToCart}>Add to Quote</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
