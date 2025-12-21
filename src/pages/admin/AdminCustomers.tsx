import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/api-client';
import type { Customer } from '@/lib/api-types';
import { Search, Plus, Eye } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { getCurrentSession, hasPermission } from '@/lib/auth';

export default function AdminCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const session = getCurrentSession();

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; data: Customer[] }>('/api/customers');
      if (response.success) {
        // Note: lastOrderAt may not be in API response, adjust sorting if needed
        setCustomers(response.data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
      }
    } catch (error) {
      console.error('Failed to load customers:', error);
    }
  };

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase()) ||
    c.org?.toLowerCase().includes(search.toLowerCase())
  );

  const canWrite = hasPermission(session, 'customers', 'write');

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
              <Button>
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
                  <TableHead>Tags</TableHead>
                  <TableHead>Lifetime Value</TableHead>
                  <TableHead>Last Order</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCustomers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell>{customer.org || '—'}</TableCell>
                    <TableCell>{customer.email || '—'}</TableCell>
                    <TableCell>{customer.phone || '—'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {customer.tags.map((tag, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>${customer.lifetimeValue.toFixed(2)}</TableCell>
                    <TableCell>
                      {customer.lastOrderAt
                        ? new Date(customer.lastOrderAt).toLocaleDateString()
                        : 'Never'}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon">
                        <Eye className="w-4 h-4" />
                      </Button>
                    </TableCell>
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
