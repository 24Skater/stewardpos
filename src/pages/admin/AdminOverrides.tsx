import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useRegisterOverrides } from '@/hooks/queries';
import { useRegisters } from '@/hooks/queries';
import type { OverrideAction, RegisterOverride } from '@/lib/api';

/**
 * Every manager override ever granted.
 *
 * This is the record that makes an override defensible after the fact: two
 * people were involved, and the log says which two, at which till, for what.
 *
 * It deliberately shows grants that were **never used**. The backend keeps
 * them on purpose — a supervisor being called over repeatedly and declining,
 * or a grant issued and abandoned, is a pattern worth being able to see, and
 * hiding unconsumed rows would make the log describe only the approvals that
 * succeeded.
 */

const ACTION_LABELS: Record<OverrideAction, string> = {
  discount_approval: 'Discount approval',
  drawer_variance: 'Drawer variance',
  void: 'Void sale',
  no_sale: 'No-sale drawer open',
};

/** A grant is spent, still live, or was never used and has lapsed. */
function grantState(row: RegisterOverride): { label: string; variant: 'default' | 'secondary' | 'outline' } {
  if (row.consumedAt) return { label: 'Used', variant: 'default' };
  if (row.expiresAt > Date.now()) return { label: 'Awaiting use', variant: 'secondary' };
  return { label: 'Never used', variant: 'outline' };
}

function formatWhen(epochMs: number): string {
  return new Date(epochMs).toLocaleString();
}

/** Values are stored as text, so a money-looking one still reads as money. */
function formatValue(value: string | null): string {
  if (value === null || value === '') return '—';
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber.toFixed(2) : value;
}

export default function AdminOverrides() {
  const [registerId, setRegisterId] = useState<string>('all');

  const { data: registers } = useRegisters();
  const { data, isLoading } = useRegisterOverrides(
    registerId === 'all' ? undefined : { registerId }
  );

  // `getList` returns the paginated envelope, not a bare array.
  const rows: RegisterOverride[] = data?.data ?? [];

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-foreground">Manager Overrides</h1>
            <p className="text-muted-foreground">
              Every privileged action a supervisor authorised at a till, including grants that were
              never used.
            </p>
          </div>

          <div className="mb-4 max-w-xs">
            <Label htmlFor="register-filter">Register</Label>
            <Select value={registerId} onValueChange={setRegisterId}>
              <SelectTrigger id="register-filter" aria-label="Filter by register">
                <SelectValue placeholder="All registers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All registers</SelectItem>
                {(registers ?? []).map((register) => (
                  <SelectItem key={register.id} value={register.id}>
                    {register.displayCode} — {register.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <p className="text-muted-foreground">Loading overrides…</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground">
              No overrides have been granted{registerId === 'all' ? '' : ' at this register'} yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">When</TableHead>
                    <TableHead scope="col">Register</TableHead>
                    <TableHead scope="col">Action</TableHead>
                    <TableHead scope="col">Approved by</TableHead>
                    <TableHead scope="col">Requested by</TableHead>
                    <TableHead scope="col">Before</TableHead>
                    <TableHead scope="col">After</TableHead>
                    <TableHead scope="col">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const state = grantState(row);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap">{formatWhen(row.createdAt)}</TableCell>
                        <TableCell>{row.registerDisplayCode ?? row.registerId}</TableCell>
                        <TableCell>{ACTION_LABELS[row.action] ?? row.action}</TableCell>
                        <TableCell>{row.approverName ?? '—'}</TableCell>
                        <TableCell>{row.requestedByName ?? '—'}</TableCell>
                        <TableCell>{formatValue(row.beforeValue)}</TableCell>
                        <TableCell>{formatValue(row.afterValue)}</TableCell>
                        <TableCell>
                          {/* Text, not colour alone - the status is the whole
                              point of the row and must survive a greyscale
                              print or a colour-blind reader. */}
                          <Badge variant={state.variant}>{state.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
