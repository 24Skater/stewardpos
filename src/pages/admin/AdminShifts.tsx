import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useRegisterShiftLog, useRegisters } from '@/hooks/queries';
import { adminApi } from '@/lib/api';
import type { RegisterShift, ShiftEndReason } from '@/lib/api';

/**
 * The shift log: who stood at which till, when, and how the shift ended.
 *
 * Shifts have been recorded since migration 018 and, until this screen, could
 * not be looked at anywhere. Every shift endpoint before
 * `GET /api/registers/shifts` answered only "who is on this register right
 * now" — which is all a till needs, and none of what someone asking "who was
 * on the floor on Tuesday" needs. A record kept and never readable is not a
 * record.
 *
 * Read-only on purpose. A shift ends at the till, by signing out or by going
 * idle; ending one from the back office is a different feature with different
 * consequences — a cashier's screen locking under them mid-sale — and is not
 * smuggled in behind a history screen.
 */

const PAGE_SIZE = 50;

/** The sentinel for "no filter"; Radix Select cannot hold an empty value. */
const ANY = 'any';

/**
 * How a shift ended, in the words a manager uses.
 *
 * These carry more meaning than they look: `superseded` means somebody signed
 * on over the top of this cashier, and `idle_timeout` means nobody signed out
 * at all. Both are ordinary, and both read as "the shift just stopped" if the
 * raw enum is printed instead.
 */
const END_REASONS: Record<ShiftEndReason, { label: string; hint: string }> = {
  signed_out: { label: 'Signed out', hint: 'The cashier signed out at the till.' },
  idle_timeout: { label: 'Idle timeout', hint: 'Nobody signed out; the till locked itself.' },
  superseded: { label: 'Taken over', hint: 'Another cashier signed on over this shift.' },
  revoked: { label: 'Device revoked', hint: 'The device credential for this till was revoked.' },
  forced: { label: 'Ended by a manager', hint: 'A manager ended this shift.' },
};

function formatWhen(epochMs: number): string {
  return new Date(epochMs).toLocaleString();
}

/**
 * How long the shift ran, or has been running.
 *
 * An open shift is measured to now rather than left blank: "on for three
 * hours" is the number a manager actually wants, and a blank would read as
 * missing data rather than as an open shift.
 */
function formatDuration(row: RegisterShift): string {
  const end = row.endedAt ?? Date.now();
  const minutes = Math.max(0, Math.round((end - row.startedAt) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** A date input holds a local calendar day; the API takes epoch milliseconds. */
function startOfDay(value: string): number | undefined {
  return value ? new Date(`${value}T00:00:00`).getTime() : undefined;
}

function endOfDay(value: string): number | undefined {
  return value ? new Date(`${value}T23:59:59.999`).getTime() : undefined;
}

export default function AdminShifts() {
  const [registerId, setRegisterId] = useState(ANY);
  const [userId, setUserId] = useState(ANY);
  const [openOnly, setOpenOnly] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);

  const { data: registers } = useRegisters();
  const { data: users = [] } = useQuery({
    queryKey: ['users-for-shift-log'],
    queryFn: () => adminApi.users.list(),
  });

  const { data, isLoading, isError } = useRegisterShiftLog({
    limit: PAGE_SIZE,
    offset,
    registerId: registerId === ANY ? undefined : registerId,
    userId: userId === ANY ? undefined : userId,
    // `undefined` rather than `false`, so "all shifts" leaves the parameter
    // off the URL entirely instead of sending a filter that means nothing.
    openOnly: openOnly || undefined,
    from: startOfDay(from),
    to: endOfDay(to),
  });

  // `getList` returns the paginated envelope, not a bare array.
  const rows: RegisterShift[] = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  /**
   * Any filter change starts over at page one — page three of the previous
   * result is meaningless under a new filter, and usually empty, which reads
   * as "no shifts" rather than as "wrong page".
   */
  function changeFilter(apply: () => void) {
    apply();
    setOffset(0);
  }

  const openCount = rows.filter((row) => row.endedAt === null).length;

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-foreground">Shifts</h1>
            <p className="text-muted-foreground">
              Who was signed on to each till, when, and how the shift ended. A shift starts when a
              cashier enters their PIN at a register and ends when they sign out there.
            </p>
          </div>

          <div className="mb-6 flex flex-wrap items-end gap-4">
            <div className="grid gap-1">
              <Label htmlFor="shift-register" className="text-xs text-muted-foreground">
                Register
              </Label>
              <Select
                value={registerId}
                onValueChange={(value) => changeFilter(() => setRegisterId(value))}
              >
                <SelectTrigger id="shift-register" className="w-56">
                  <SelectValue placeholder="Any register" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any register</SelectItem>
                  {(registers ?? []).map((register) => (
                    <SelectItem key={register.id} value={register.id}>
                      {register.displayCode} — {register.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1">
              <Label htmlFor="shift-cashier" className="text-xs text-muted-foreground">
                Cashier
              </Label>
              <Select value={userId} onValueChange={(value) => changeFilter(() => setUserId(value))}>
                <SelectTrigger id="shift-cashier" className="w-56">
                  <SelectValue placeholder="Any cashier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any cashier</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1">
              <Label htmlFor="shift-from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="shift-from"
                type="date"
                value={from}
                onChange={(event) => changeFilter(() => setFrom(event.target.value))}
              />
            </div>

            <div className="grid gap-1">
              <Label htmlFor="shift-to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="shift-to"
                type="date"
                value={to}
                onChange={(event) => changeFilter(() => setTo(event.target.value))}
              />
            </div>

            <Button
              variant={openOnly ? 'default' : 'outline'}
              aria-pressed={openOnly}
              onClick={() => changeFilter(() => setOpenOnly((previous) => !previous))}
            >
              On the floor now
            </Button>
          </div>

          {isError ? (
            <p className="text-destructive">The shift log could not be loaded.</p>
          ) : isLoading ? (
            <p className="text-muted-foreground">Loading shifts…</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground">
              {openOnly
                ? 'Nobody is signed on to a till right now.'
                : 'No shifts match these filters.'}
            </p>
          ) : (
            <>
              <p className="mb-2 text-sm text-muted-foreground" role="status">
                {total} shift{total === 1 ? '' : 's'}
                {openCount > 0 && ` · ${openCount} open on this page`}
              </p>

              <div className="overflow-x-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Started</TableHead>
                      <TableHead scope="col">Cashier</TableHead>
                      <TableHead scope="col">Register</TableHead>
                      <TableHead scope="col">Location</TableHead>
                      <TableHead scope="col">Duration</TableHead>
                      <TableHead scope="col">Ended</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const reason = row.endReason ? END_REASONS[row.endReason] : null;
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="whitespace-nowrap">
                            {formatWhen(row.startedAt)}
                          </TableCell>
                          <TableCell>
                            <div>
                              <span className="font-medium">{row.cashierName ?? row.userId}</span>
                              {/* Migration 020: an admin covering a till is
                                  attributed to themselves, never to the person
                                  they stood in for. Saying so on the row stops
                                  that reading as a mis-attribution. */}
                              {row.emulatedUserName && (
                                <p className="text-xs text-muted-foreground">
                                  covering for {row.emulatedUserName}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{row.registerDisplayCode ?? row.registerId}</TableCell>
                          <TableCell>{row.locationName ?? '—'}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDuration(row)}</TableCell>
                          <TableCell>
                            {/* Text, not colour alone — an open shift is the
                                one state a reader must not miss. */}
                            {row.endedAt === null ? (
                              <Badge>On the floor</Badge>
                            ) : (
                              <div>
                                <Badge variant="outline" title={reason?.hint}>
                                  {reason?.label ?? row.endReason}
                                </Badge>
                                <p className="text-xs text-muted-foreground">
                                  {formatWhen(row.endedAt)}
                                </p>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {offset + 1}–{offset + rows.length} of {total}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={offset === 0}
                    onClick={() => setOffset((previous) => Math.max(0, previous - PAGE_SIZE))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!data?.meta?.hasMore}
                    onClick={() => setOffset((previous) => previous + PAGE_SIZE)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
