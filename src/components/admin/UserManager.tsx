import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { adminApi } from '@/lib/api';
import type { Role, User } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useToast } from '@/hooks/use-toast';
import { Edit, Loader2, Plus, UserCheck, UserX } from 'lucide-react';

interface UserManagerProps {
  roles: Role[];
  currentUserId?: string;
  canEdit: boolean;
  /** Called after any change, so dependants (the PIN list) can reload. */
  onChanged?: () => void;
}

interface Draft {
  name: string;
  email: string;
  password: string;
  roleIds: string[];
  canOverride: boolean;
}

const EMPTY: Draft = { name: '', email: '', password: '', roleIds: [], canOverride: false };

/** Staff accounts: who can sign in to the admin screens, and with which roles. */
export default function UserManager({ roles, currentUserId, canEdit, onChanged }: UserManagerProps) {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async () => {
    try {
      setUsers(await adminApi.users.list());
    } catch (error: unknown) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Failed to load users'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? 'Unknown role';

  const open = (user: User | 'new') => {
    setDraft(user === 'new' ? EMPTY : { name: user.name, email: user.email, password: '', roleIds: user.roleIds, canOverride: !!user.canOverride });
    setFormError(null);
    setEditing(user);
  };

  const toggleRole = (id: string, on: boolean) =>
    setDraft((d) => ({ ...d, roleIds: on ? [...d.roleIds, id] : d.roleIds.filter((r) => r !== id) }));

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    try {
      const base = { name: draft.name.trim(), email: draft.email.trim(), roleIds: draft.roleIds };
      if (editing === 'new') {
        const created = await adminApi.users.create({ ...base, password: draft.password });
        // The create endpoint does not take canOverride; set it as a follow-up.
        if (draft.canOverride) await adminApi.users.update(created.id, { canOverride: true });
      } else {
        await adminApi.users.update(editing.id, {
          ...base,
          canOverride: draft.canOverride,
          ...(draft.password ? { password: draft.password } : {}),
        });
      }
      toast({ title: editing === 'new' ? 'User added' : 'User updated' });
      setEditing(null);
      await load();
      onChanged?.();
    } catch (error: unknown) {
      setFormError(getErrorMessage(error, 'The user could not be saved'));
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (user: User, status: User['status']) => {
    try {
      await adminApi.users.update(user.id, { status });
      toast({ title: status === 'active' ? `${user.name} reactivated` : `${user.name} deactivated` });
      await load();
      onChanged?.();
    } catch (error: unknown) {
      toast({ title: 'Could not change status', description: getErrorMessage(error), variant: 'destructive' });
    }
  };

  const isNew = editing === 'new';
  const canSave = draft.name.trim() && draft.email.trim() && draft.roleIds.length > 0 && (!isNew || draft.password);

  return (
    <section className="mt-10 space-y-4" aria-labelledby="users-heading">
      <div className="flex items-center justify-between">
        <div>
          <h2 id="users-heading" className="text-lg font-semibold text-foreground">Users</h2>
          <p className="text-sm text-muted-foreground">Staff who sign in to the admin screens. Deactivating keeps their sales history.</p>
        </div>
        {canEdit && (
          <Button onClick={() => open('new')}>
            <Plus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        )}
      </div>

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last sign-in</TableHead>
              {canEdit && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}{user.id === currentUserId && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.roleIds.map(roleName).join(', ') || '—'}</TableCell>
                  <TableCell>
                    <Badge variant={user.status === 'active' ? 'default' : 'secondary'}>{user.status === 'active' ? 'Active' : 'Inactive'}</Badge>
                  </TableCell>
                  <TableCell>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}</TableCell>
                  {canEdit && (
                    <TableCell className="space-x-1 whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => open(user)} aria-label={`Edit ${user.name}`}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      {user.id !== currentUserId && (user.status === 'active' ? (
                        <Button variant="ghost" size="sm" onClick={() => setStatus(user, 'inactive')} aria-label={`Deactivate ${user.name}`}>
                          <UserX className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setStatus(user, 'active')} aria-label={`Reactivate ${user.name}`}>
                          <UserCheck className="h-4 w-4" />
                        </Button>
                      ))}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNew ? 'Add User' : 'Edit User'}</DialogTitle>
            <DialogDescription>
              {isNew ? 'They sign in with this email and password.' : 'Leave the password blank to keep the current one.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="user-name">Name</Label>
              <Input id="user-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="user-email">Email</Label>
              <Input id="user-email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="user-password">{isNew ? 'Password' : 'New password'}</Label>
              <Input id="user-password" type="password" autoComplete="new-password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Roles</legend>
              {roles.map((role) => (
                <div key={role.id} className="flex items-center gap-2">
                  <Checkbox id={`user-role-${role.id}`} checked={draft.roleIds.includes(role.id)} onCheckedChange={(c) => toggleRole(role.id, c === true)} />
                  <Label htmlFor={`user-role-${role.id}`} className="font-normal">{role.name}</Label>
                </div>
              ))}
            </fieldset>
            <div className="flex items-center gap-2">
              <Checkbox id="user-can-override" checked={draft.canOverride} onCheckedChange={(c) => setDraft({ ...draft, canOverride: c === true })} />
              <Label htmlFor="user-can-override" className="font-normal">Approves manager overrides at the till</Label>
            </div>
            {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !canSave}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isNew ? 'Add User' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
