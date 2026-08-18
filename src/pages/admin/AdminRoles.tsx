import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { adminApi } from '@/lib/api';
import {
  PERMISSION_RESOURCES,
  type AppRole as SystemRoleName,
  type RolePermissions,
} from '@/lib/permissions';
import { Search, Plus, Edit, Trash2 } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { getCurrentSession, hasAnyRole, hasPermission, type AuthSession } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/errors';
import CashierPinManager from '@/components/admin/CashierPinManager';

interface Role {
  id: string;
  name: string;
  systemRole?: SystemRoleName;
  permissions: RolePermissions;
}

/**
 * The matrix rendered by the editor, and the blank slate a new role starts from.
 *
 * Both derive from PERMISSION_RESOURCES rather than being listed again here: the
 * previous hand-written copy silently omitted every resource added after it was
 * written, so those permissions could not be granted through the UI at all.
 */
const permissionModules = PERMISSION_RESOURCES;

const defaultPermissions = Object.fromEntries(
  PERMISSION_RESOURCES.map((resource) => [resource, { read: false, write: false, delete: false }])
) as unknown as RolePermissions;

/** Short explanations for the resources whose scope is not obvious from the name. */
const MODULE_HINTS: Partial<Record<keyof RolePermissions, string>> = {
  orders: 'Ringing sales, receipts, and the card terminal',
  returns: 'Refunds and restocking',
  discounts: 'Discount types, promo codes, and employee entitlements',
  exports: 'Downloading data extracts',
  users: 'Staff accounts and roles',
  settings: 'Store configuration and audit log',
};

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
      const response = await adminApi.roles.list();
      setRoles(response);
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: getErrorMessage(error, 'Failed to load roles'),
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
  // Gates the PIN section below with the same resource the backend's
  // `/api/admin/users` routes are gated on (`requirePermission('users', 'write')`),
  // rather than admin-only — a store manager who can create staff accounts
  // should also be able to set their PINs.
  const canManagePins = hasPermission(session, 'users', 'write');

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
        const response = await adminApi.roles.create({
          name: editingRole.name,
          systemRole: editingRole.systemRole,
          permissions: editingRole.permissions,
        });
        toast({ title: 'Role created successfully' });
      } else {
        const response = await adminApi.roles.update(editingRole.id, {
          name: editingRole.name,
          systemRole: editingRole.systemRole,
          permissions: editingRole.permissions,
        });
        toast({ title: 'Role updated successfully' });
      }

      setEditDialogOpen(false);
      setEditingRole(null);
      setIsNewRole(false);
      await loadRoles();
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: getErrorMessage(error, 'Failed to save role'),
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
      const response = await adminApi.roles.remove(id);
      toast({ title: 'Role deleted successfully' });
      await loadRoles();
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: getErrorMessage(error, 'Failed to delete role'),
        variant: 'destructive',
      });
    }
  };

  const updatePermission = (
    module: keyof RolePermissions,
    action: 'read' | 'write' | 'delete',
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
                          systemRole: value === 'none' ? undefined : (value as SystemRoleName) 
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
                              <TableCell className="font-medium">
                                <span className="capitalize">{module}</span>
                                {MODULE_HINTS[module] && (
                                  <p className="text-xs font-normal text-muted-foreground">
                                    {MODULE_HINTS[module]}
                                  </p>
                                )}
                              </TableCell>
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

          {canManagePins && <CashierPinManager />}
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
