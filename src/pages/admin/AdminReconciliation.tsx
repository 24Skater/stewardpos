import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import AdminLayout from '@/components/AdminLayout';
import { useToast } from '@/hooks/use-toast';
import { reconciliationApi, type UnreconciledPayment } from '@/lib/api/reconciliation';
import { getErrorMessage } from '@/lib/errors';

/**
 * Card payments that took money and never became a sale.
 *
 * Every other screen in the admin area answers "what did we sell?". This one
 * answers the question nobody could ask before: "what did we charge that we
 * cannot account for?" Until the payment-attempt record existed, a charge whose
 * order never got written was invisible here and findable only by reading the
 * Stripe dashboard against the day's sales by hand.
 *
 * Three actions, matching the three things that are actually true of a row like
 * this. The charge succeeded and we simply missed it — **re-check** asks the
 * processor. The charge succeeded and the customer never got their goods —
 * **refund**. Somebody has looked into it and it needs nothing further —
 * **dismiss**, with a reason.
 *
 * There is deliberately no "create the order". Building a sale from here would
 * invent line items nobody rang and skip the shift, drawer and override checks
 * that a real checkout enforces. Refund and re-ring is the honest repair, and
 * it is the one a shop can explain to a customer standing in front of them.
 */

function money(amountCents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
    amountCents / 100
  );
}

function formatWhen(epochMs: number): string {
  return new Date(epochMs).toLocaleString();
}

/** Roughly how long this has been sitting unresolved. */
function age(epochMs: number): string {
  const minutes = Math.floor((Date.now() - epochMs) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * What the charge was for, from the cart the server priced at the time.
 *
 * Without this a row says a card was charged $40 and nothing about what for,
 * which is not enough for anyone to decide whether to refund it.
 */
function describeCart(snapshot: unknown): string {
  const cart = snapshot as { items?: Array<{ quantity?: number }> } | null;
  const items = cart?.items;
  if (!Array.isArray(items) || items.length === 0) return 'No cart recorded';
  const units = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  return `${items.length} line${items.length === 1 ? '' : 's'}, ${units} item${units === 1 ? '' : 's'}`;
}

/**
 * What the status means here, rather than what it is called.
 *
 * `authorized` is the serious one: the money moved. `pending` means we never
 * found out either way, which needs a question asked before anything else.
 */
const STATUS_MEANING: Record<string, { label: string; hint: string; tone: 'destructive' | 'secondary' }> = {
  authorized: {
    label: 'Charged, no sale',
    hint: 'The card was charged and no order was recorded against it.',
    tone: 'destructive',
  },
  pending: {
    label: 'Outcome unknown',
    hint: 'The charge was started and we never learned how it ended. Check it before anything else.',
    tone: 'secondary',
  },
};

export default function AdminReconciliation() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dismissing, setDismissing] = useState<UnreconciledPayment | null>(null);
  const [dismissReason, setDismissReason] = useState('');

  const {
    data: payments = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ['reconciliation'],
    queryFn: () => reconciliationApi.list(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['reconciliation'] });

  const recheck = useMutation({
    mutationFn: (id: string) => reconciliationApi.recheck(id),
    onSuccess: (result) => {
      toast({
        title: 'Checked with the processor',
        description: `The processor reports this payment as ${result.status}.`,
      });
      refresh();
    },
    onError: (err: unknown) =>
      toast({ title: 'Could not check', description: getErrorMessage(err), variant: 'destructive' }),
  });

  const refund = useMutation({
    mutationFn: (id: string) => reconciliationApi.refund(id),
    onSuccess: () => {
      toast({ title: 'Refunded', description: 'The money has been sent back to the card.' });
      refresh();
    },
    onError: (err: unknown) =>
      toast({ title: 'Refund failed', description: getErrorMessage(err), variant: 'destructive' }),
  });

  const dismiss = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      reconciliationApi.dismiss(id, reason),
    onSuccess: () => {
      toast({ title: 'Marked as resolved' });
      setDismissing(null);
      setDismissReason('');
      refresh();
    },
    onError: (err: unknown) =>
      toast({ title: 'Could not dismiss', description: getErrorMessage(err), variant: 'destructive' }),
  });

  const busy = recheck.isPending || refund.isPending || dismiss.isPending;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Unreconciled Charges</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Card payments that took money without a sale recorded against them. Payments still in
            progress are not listed.
          </p>
        </div>

        {isError && (
          <p className="text-sm text-destructive">{getErrorMessage(error, 'Could not load payments')}</p>
        )}

        {isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : payments.length === 0 ? (
          <div className="rounded-md border border-border p-8 text-center">
            <p className="font-medium">Nothing to reconcile</p>
            <p className="text-sm text-muted-foreground mt-1">
              Every card payment has a sale recorded against it.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Taken</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>What for</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Processor reference</TableHead>
                  <TableHead className="text-right">Resolve</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => {
                  const meaning = STATUS_MEANING[payment.status] ?? {
                    label: payment.status,
                    hint: '',
                    tone: 'secondary' as const,
                  };
                  return (
                    <TableRow key={payment.id}>
                      <TableCell className="whitespace-nowrap">
                        <div>{formatWhen(payment.createdAt)}</div>
                        <div className="text-xs text-muted-foreground">{age(payment.createdAt)} ago</div>
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">
                        {money(payment.amountCents, payment.currency)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {describeCart(payment.cartSnapshot)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={meaning.tone}>{meaning.label}</Badge>
                        {meaning.hint && (
                          <p className="text-xs text-muted-foreground mt-1 max-w-[22rem]">{meaning.hint}</p>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {payment.chargeId ?? <span className="text-muted-foreground">never sent</span>}
                      </TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !payment.chargeId}
                          onClick={() => recheck.mutate(payment.id)}
                        >
                          Re-check
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy || !payment.chargeId}
                          onClick={() => refund.mutate(payment.id)}
                        >
                          Refund
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setDismissing(payment)}
                        >
                          Dismiss
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={dismissing !== null} onOpenChange={(open) => !open && setDismissing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as resolved</DialogTitle>
            <DialogDescription>
              This leaves the money where it is and takes the payment off the list. Say what
              happened, so the next person reading this knows it was looked at rather than cleared.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={dismissReason}
            onChange={(event) => setDismissReason(event.target.value)}
            placeholder="Rung again on lane 2"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissing(null)}>
              Cancel
            </Button>
            <Button
              disabled={!dismissReason.trim() || dismiss.isPending}
              onClick={() =>
                dismissing && dismiss.mutate({ id: dismissing.id, reason: dismissReason.trim() })
              }
            >
              Mark resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
