import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { apiClient } from '@/lib/api-client';
import { Search, Plus, Edit, Trash2 } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { getCurrentSession, hasAnyRole, type AuthSession } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';

interface Permission {
  read: boolean;
  write: boolean;
  delete: boolean;
}

interface Permissions {
  inventory: Permission;
  reports: Permission;
  exports: Permission;
  settings: Permission;
  users: Permission;
  services: Permission;
  customers: Permission;
}

interface Role {
  id: string;
  name: string;
  systemRole?: string;
  permissions: Permissions;
}

const defaultPermissions: Permissions = {
  inventory: { read: false, write: false, delete: false },
  reports: { read: false, write: false, delete: false },
  exports: { read: false, write: false, delete: false },
  settings: { read: false, write: false, delete: false },
  users: { read: false, write: false, delete: false },
  services: { read: false, write: false, delete: false },
  customers: { read: false, write: false, delete: false },
};

const permissionModules = [
  'inventory',
  'reports',
  'exports',
  'settings',
  'users',
  'services',
  'customers',
] as const;

export default function AdminRoles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isNewRole, setIsNewRole] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const loadSession = async () => {
      const currentSession = await getCurrentSession();
      setSession(currentSession);
    };
    loadSession();
  }, []);

  useEffect(() => {
    loadRoles();
  }, []);

  const loadRoles = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<{ success: boolean; data: Role[] }>('/api/admin/roles');
      if (response.success) {
        setRoles(response.data);
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load roles',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredRoles = roles.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase())
  );

  const isAdmin = hasAnyRole(session, ['admin']);

  const handleAddRole = () => {
    setEditingRole({
      id: '',
      name: '',
      systemRole: undefined,
      permissions: { ...defaultPermissions },
    });
    setIsNewRole(true);
    setEditDialogOpen(true);
  };

  const handleEditRole = (role: Role) => {
    setEditingRole({ 
      ...role,
      permissions: { ...defaultPermissions, ...role.permissions }
    });
    setIsNewRole(false);
    setEditDialogOpen(true);
  };

  const handleSaveRole = async () => {
    if (!editingRole || !editingRole.name) {
      toast({
        title: 'Error',
        description: 'Role name is required',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (isNewRole) {
        const response = await apiClient.post<{ success: boolean; data: Role }>('/api/admin/roles', {
          name: editingRole.name,
          systemRole: editingRole.systemRole,
          permissions: editingRole.permissions,
        });
        if (response.success) {
          toast({ title: 'Role created successfully' });
        }
      } else {
        const response = await apiClient.put<{ success: boolean; data: Role }>(`/api/admin/roles/${editingRole.id}`, {
          name: editingRole.name,
          systemRole: editingRole.systemRole,
          permissions: editingRole.permissions,
        });
        if (response.success) {
          toast({ title: 'Role updated successfully' });
        }
      }

      setEditDialogOpen(false);
      setEditingRole(null);
      setIsNewRole(false);
      await loadRoles();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save role',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteRole = async (id: string) => {
    const role = roles.find(r => r.id === id);
    if (role?.systemRole === 'admin') {
      toast({
        title: 'Error',
        description: 'Cannot delete the admin role',
        variant: 'destructive',
      });
      return;
    }

    if (!confirm('Are you sure you want to delete this role?')) return;

    try {
      const response = await apiClient.delete<{ success: boolean }>(`/api/admin/roles/${id}`);
      if (response.success) {
        toast({ title: 'Role deleted successfully' });
        await loadRoles();
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete role',
        variant: 'destructive',
      });
    }
  };

  const updatePermission = (
    module: keyof Permissions,
    action: keyof Permission,
    value: boolean
  ) => {
    if (!editingRole) return;
    
    setEditingRole({
      ...editingRole,
      permissions: {
        ...editingRole.permissions,
        [module]: {
          ...editingRole.permissions[module],
          [action]: value,
        },
      },
    });
  };

  const getPermissionCount = (role: Role): number => {
    if (!role.permissions) return 0;
    let count = 0;
    for (const module of permissionModules) {
      const perm = role.permissions[module];
      if (perm) {
        if (perm.read) count++;
        if (perm.write) count++;
        if (perm.delete) count++;
      }
    }
    return count;
  };

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Roles & Permissions</h1>
              <p className="text-muted-foreground">Manage user roles and access permissions</p>
            </div>
            {isAdmin && (
              <Button onClick={handleAddRole}>
                <Plus className="w-4 h-4 mr-2" />
                Add Role
              </Button>
            )}
          </div>

          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search roles..."
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
                  <TableHead>Role Name</TableHead>
                  <TableHead>System Role</TableHead>
                  <TableHead>Permissions</TableHead>
                  {isAdmin && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                      Loading roles...
                    </TableCell>
                  </TableRow>
                ) : filteredRoles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No roles found. {isAdmin && 'Click "Add Role" to create one.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRoles.map((role) => (
                    <TableRow key={role.id}>
                      <TableCell className="font-medium">{role.name}</TableCell>
                      <TableCell>
                        {role.systemRole ? (
                          <Badge variant="outline" className="capitalize">
                            {role.systemRole}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">
                          {getPermissionCount(role)} permissions
                        </span>
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="icon" onClick={() => handleEditRole(role)}>
                              <Edit className="w-4 h-4" />
                            </Button>
                            {role.systemRole !== 'admin' && (
                              <Button variant="ghost" size="icon" onClick={() => handleDeleteRole(role.id)}>
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

          {/* Edit/Create Role Dialog */}
          <Dialog open={editDialogOpen} onOpenChange={(open) => {
            setEditDialogOpen(open);
            if (!open) {
              setEditingRole(null);
              setIsNewRole(false);
            }
          }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{isNewRole ? 'Add Role' : 'Edit Role'}</DialogTitle>
                <DialogDescription>
                  {isNewRole ? 'Create a new role with specific permissions' : 'Update role permissions'}
                </DialogDescription>
              </DialogHeader>
              {editingRole && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Role Name *</Label>
                      <Input
                        id="name"
                        value={editingRole.name}
                        onChange={(e) => setEditingRole({ ...editingRole, name: e.target.value })}
                        placeholder="e.g., Sales Manager"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="systemRole">System Role (Optional)</Label>
                      <Select
                        value={editingRole.systemRole || 'none'}
                        onValueChange={(value) => setEditingRole({ 
                          ...editingRole, 
                          systemRole: value === 'none' ? undefined : value 
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select system role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="supervisor">Supervisor</SelectItem>
                          <SelectItem value="reporter">Reporter</SelectItem>
                          <SelectItem value="standard">Standard</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <Label>Permissions</Label>
                    <div className="border rounded-lg">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Module</TableHead>
                            <TableHead className="text-center w-24">Read</TableHead>
                            <TableHead className="text-center w-24">Write</TableHead>
                            <TableHead className="text-center w-24">Delete</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {permissionModules.map((module) => (
                            <TableRow key={module}>
                              <TableCell className="capitalize font-medium">{module}</TableCell>
                              <TableCell className="text-center">
                                <Checkbox
                                  checked={editingRole.permissions[module]?.read || false}
                                  onCheckedChange={(checked) => 
                                    updatePermission(module, 'read', checked === true)
                                  }
                                />
                              </TableCell>
                              <TableCell className="text-center">
                                <Checkbox
                                  checked={editingRole.permissions[module]?.write || false}
                                  onCheckedChange={(checked) => 
                                    updatePermission(module, 'write', checked === true)
                                  }
                                />
                              </TableCell>
                              <TableCell className="text-center">
                                <Checkbox
                                  checked={editingRole.permissions[module]?.delete || false}
                                  onCheckedChange={(checked) => 
                                    updatePermission(module, 'delete', checked === true)
                                  }
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveRole}>
                  {isNewRole ? 'Create Role' : 'Save Changes'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
