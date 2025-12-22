import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { getAllServices, Service } from '@/lib/db';
import { Search, Plus, Edit, Trash2 } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { getCurrentSession, hasPermission, type AuthSession } from '@/lib/auth';

export default function AdminServices() {
  const [services, setServices] = useState<Service[]>([]);
  const [search, setSearch] = useState('');
  const [session, setSession] = useState<AuthSession | null>(null);

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
    const data = await getAllServices();
    setServices(data);
  };

  const filteredServices = services.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.category.toLowerCase().includes(search.toLowerCase())
  );

  const canWrite = hasPermission(session, 'services', 'write');
  const canDelete = hasPermission(session, 'services', 'delete');

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
              <Button>
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
                {filteredServices.map((service) => (
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
                            <Button variant="ghost" size="icon">
                              <Edit className="w-4 h-4" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button variant="ghost" size="icon">
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
