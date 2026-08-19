import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { money } from './SalesReport';
import { ReportLoadingState } from './ReportLoadingState';
import type { RegisterSales, RegisterStatus, SalesByRegisterResult } from '@/lib/api';

export interface RegisterReportProps {
  data: SalesByRegisterResult | null;
  loading: boolean;
  error: string | null;
}

/** A share of the whole, or an em dash rather than a division by zero. */
function shareOf(part: number, whole: number): string {
  if (whole === 0) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

/**
 * A register that is not currently `active`, spelled out in text.
 *
 * `null` for `active` on purpose: the common case gets no badge at all, so a
 * retired or disabled till that still traded in range stands out rather than
 * being one badge among a row of identical "Active" ones.
 */
function statusBadge(status: RegisterStatus) {
  if (status === 'active') return null;
  const labels: Record<Exclude<RegisterStatus, 'active'>, string> = {
    retired: 'Retired',
    disabled: 'Disabled',
    pending: 'Pending',
  };
  return (
    <Badge variant="outline" className="ml-2">
      {labels[status]}
    </Badge>
  );
}

/**
 * How many sales went through each till, and the web-vs-drawer split — the
 * question this whole reporting phase exists to answer.
 *
 * Every figure comes from `getSalesByRegister`/`getRegisterCapabilitySplit`
 * as the server computed them; nothing here re-derives an average or a share
 * from the individual rows beyond a simple percentage of an already-summed
 * total, which is safe because it is not money.
 */
export default function RegisterReport({ data, loading, error }: RegisterReportProps) {
  if (loading) return <ReportLoadingState tiles={2} />;

  if (error) {
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>The register report could not be loaded</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">{error}</CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { registers, capabilitySplit } = data;
  // Net descending: a manager wants to know which lane earns first.
  const rows: RegisterSales[] = [...registers].sort((a, b) => b.net - a.net);
  const totalNet = capabilitySplit.drawerCapable.net + capabilitySplit.nonDrawerCapable.net;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Drawer-capable registers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{money(capabilitySplit.drawerCapable.net)}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {capabilitySplit.drawerCapable.registerCount}{' '}
              {capabilitySplit.drawerCapable.registerCount === 1 ? 'till' : 'tills'} ·{' '}
              {capabilitySplit.drawerCapable.orderCount} sales ·{' '}
              {shareOf(capabilitySplit.drawerCapable.net, totalNet)} of net
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Web / no-drawer registers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{money(capabilitySplit.nonDrawerCapable.net)}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {capabilitySplit.nonDrawerCapable.registerCount}{' '}
              {capabilitySplit.nonDrawerCapable.registerCount === 1 ? 'till' : 'tills'} ·{' '}
              {capabilitySplit.nonDrawerCapable.orderCount} sales ·{' '}
              {shareOf(capabilitySplit.nonDrawerCapable.net, totalNet)} of net
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sales by register</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No register activity was recorded in this period
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Register</TableHead>
                    <TableHead scope="col">Location</TableHead>
                    <TableHead scope="col">Type</TableHead>
                    <TableHead scope="col">Drawer</TableHead>
                    <TableHead scope="col" className="text-right">
                      Transactions
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Net
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Avg ticket
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((register) => (
                    <TableRow key={register.registerId}>
                      <TableCell>
                        <div className="font-medium">
                          {register.displayCode} — {register.name}
                          {statusBadge(register.status)}
                        </div>
                      </TableCell>
                      <TableCell>{register.locationName}</TableCell>
                      <TableCell className="capitalize">{register.type}</TableCell>
                      <TableCell>
                        {register.hasCashDrawer ? (
                          'Yes'
                        ) : (
                          <span className="font-medium text-amber-700 dark:text-amber-400">
                            No drawer
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{register.orderCount}</TableCell>
                      <TableCell className="text-right font-semibold">{money(register.net)}</TableCell>
                      <TableCell className="text-right">{money(register.avgTicket)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
