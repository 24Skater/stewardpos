import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { apiClient } from '@/lib/api-client';
import { Search, Plus, Edit, Trash2 } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { getCurrentSession, hasPermission, type AuthSession } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';

interface Service {
  id: string;
  name: string;
  category: string;
  description?: string;
  basePrice?: number;
  unitType: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export default function AdminServices() {
  const [services, setServices] = useState<Service[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [isNewService, setIsNewService] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const loadSession = async () => {
      const currentSession = await getCurrentSession();
      setSession(currentSession);
    };
    loadSession();
  }, []);

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<{ success: boolean; data: Service[] }>('/api/services');
      if (response.success) {
        setServices(response.data);
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load services',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredServices = services.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.category.toLowerCase().includes(search.toLowerCase())
  );

  const canWrite = hasPermission(session, 'services', 'write');
  const canDelete = hasPermission(session, 'services', 'delete');

  const handleAddService = () => {
    setEditingService({
      id: '',
      name: '',
      category: '',
      description: '',
      basePrice: 0,
      unitType: 'flat',
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setIsNewService(true);
    setEditDialogOpen(true);
  };

  const handleEditService = (service: Service) => {
    setEditingService({ ...service });
    setIsNewService(false);
    setEditDialogOpen(true);
  };

  const handleSaveService = async () => {
    if (!editingService || !editingService.name || !editingService.category) {
      toast({
        title: 'Error',
        description: 'Name and category are required',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (isNewService) {
        const response = await apiClient.post<{ success: boolean; data: Service }>('/api/services', {
          name: editingService.name,
          category: editingService.category,
          description: editingService.description,
          basePrice: editingService.basePrice,
          unitType: editingService.unitType,
          isActive: editingService.isActive,
        });
        if (response.success) {
          toast({ title: 'Service created successfully' });
        }
      } else {
        const response = await apiClient.put<{ success: boolean; data: Service }>(`/api/services/${editingService.id}`, {
          name: editingService.name,
          category: editingService.category,
          description: editingService.description,
          basePrice: editingService.basePrice,
          unitType: editingService.unitType,
          isActive: editingService.isActive,
        });
        if (response.success) {
          toast({ title: 'Service updated successfully' });
        }
      }

      setEditDialogOpen(false);
      setEditingService(null);
      setIsNewService(false);
      await loadServices();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save service',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteService = async (id: string) => {
    if (!confirm('Are you sure you want to delete this service?')) return;

    try {
      const response = await apiClient.delete<{ success: boolean }>(`/api/services/${id}`);
      if (response.success) {
        toast({ title: 'Service deleted successfully' });
        await loadServices();
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete service',
        variant: 'destructive',
      });
    }
  };

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Services Catalog</h1>
              <p className="text-muted-foreground">Manage service offerings</p>
            </div>
            {canWrite && (
              <Button onClick={handleAddService}>
                <Plus className="w-4 h-4 mr-2" />
                Add Service
              </Button>
            )}
          </div>

          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search services..."
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
                  <TableHead>Service Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Base Price</TableHead>
                  <TableHead>Unit Type</TableHead>
                  <TableHead>Status</TableHead>
                  {(canWrite || canDelete) && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      Loading services...
                    </TableCell>
                  </TableRow>
                ) : filteredServices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No services found. {canWrite && 'Click "Add Service" to create one.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredServices.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell className="font-medium">{service.name}</TableCell>
                      <TableCell>{service.category}</TableCell>
                      <TableCell className="max-w-xs truncate">{service.description}</TableCell>
                      <TableCell>
                        {service.basePrice ? `$${service.basePrice.toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell className="capitalize">{service.unitType || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={service.isActive ? 'secondary' : 'outline'}>
                          {service.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      {(canWrite || canDelete) && (
                        <TableCell>
                          <div className="flex gap-2">
                            {canWrite && (
                              <Button variant="ghost" size="icon" onClick={() => handleEditService(service)}>
                                <Edit className="w-4 h-4" />
                              </Button>
                            )}
                            {canDelete && (
                              <Button variant="ghost" size="icon" onClick={() => handleDeleteService(service.id)}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Edit/Create Service Dialog */}
          <Dialog open={editDialogOpen} onOpenChange={(open) => {
            setEditDialogOpen(open);
            if (!open) {
              setEditingService(null);
              setIsNewService(false);
            }
          }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{isNewService ? 'Add Service' : 'Edit Service'}</DialogTitle>
                <DialogDescription>
                  {isNewService ? 'Create a new service offering' : 'Update service details'}
                </DialogDescription>
              </DialogHeader>
              {editingService && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Service Name *</Label>
                    <Input
                      id="name"
                      value={editingService.name}
                      onChange={(e) => setEditingService({ ...editingService, name: e.target.value })}
                      placeholder="e.g., Photography Session"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category">Category *</Label>
                    <Input
                      id="category"
                      value={editingService.category}
                      onChange={(e) => setEditingService({ ...editingService, category: e.target.value })}
                      placeholder="e.g., Media, Audio, Consulting"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={editingService.description || ''}
                      onChange={(e) => setEditingService({ ...editingService, description: e.target.value })}
                      placeholder="Describe the service..."
                      rows={3}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="basePrice">Base Price</Label>
                      <Input
                        id="basePrice"
                        type="number"
                        step="0.01"
                        min="0"
                        value={editingService.basePrice || ''}
                        onChange={(e) => setEditingService({ ...editingService, basePrice: parseFloat(e.target.value) || 0 })}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="unitType">Unit Type</Label>
                      <Select
                        value={editingService.unitType}
                        onValueChange={(value) => setEditingService({ ...editingService, unitType: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="flat">Flat Rate</SelectItem>
                          <SelectItem value="hourly">Hourly</SelectItem>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="per_item">Per Item</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="isActive">Active</Label>
                    <Switch
                      id="isActive"
                      checked={editingService.isActive}
                      onCheckedChange={(checked) => setEditingService({ ...editingService, isActive: checked })}
                    />
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveService}>
                  {isNewService ? 'Create Service' : 'Save Changes'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
