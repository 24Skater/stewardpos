import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Wallet } from 'lucide-react';
import { drawerApi } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useToast } from '@/hooks/use-toast';

interface CashDrawerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DRAWER_KEY = ['drawer', 'current'] as const;

/**
 * Open and close the till.
 *
 * The expected figure always comes from the server and is never editable here:
 * a reconciliation only means something if the counter is comparing their count
 * against something they did not produce.
 */
export default function CashDrawerDialog({ open, onOpenChange }: CashDrawerDialogProps) {
  const [openingFloat, setOpeningFloat] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [notes, setNotes] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: session,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: DRAWER_KEY,
    queryFn: () => drawerApi.current(),
    // Only while the dialog is up; the register does not need to poll for this.
    enabled: open,
  });

  const reset = () => {
    setOpeningFloat('');
    setCountedCash('');
    setNotes('');
  };

  const openDrawer = useMutation({
    mutationFn: () => drawerApi.open(parseFloat(openingFloat) || 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DRAWER_KEY });
      reset();
      toast({ title: 'Drawer opened' });
    },
    onError: (mutationError: unknown) =>
      toast({
        title: 'Could not open the drawer',
        description: getErrorMessage(mutationError),
        variant: 'destructive',
      }),
  });

  const closeDrawer = useMutation({
    mutationFn: () => drawerApi.close(parseFloat(countedCash), notes || undefined),
    onSuccess: (closed) => {
      queryClient.invalidateQueries({ queryKey: DRAWER_KEY });
      reset();

      const variance = closed.variance ?? 0;
      toast({
        title: 'Drawer closed',
        description:
          variance === 0
            ? 'The till balanced exactly.'
            : `${variance < 0 ? 'Short' : 'Over'} by $${Math.abs(variance).toFixed(2)}.`,
        variant: variance < 0 ? 'destructive' : 'default',
      });
    },
    onError: (mutationError: unknown) =>
      toast({
        title: 'Could not close the drawer',
        description: getErrorMessage(mutationError),
        variant: 'destructive',
      }),
  });

  // Shown before committing, so a cashier sees the discrepancy while they can
  // still recount rather than after the session is sealed.
  const counted = parseFloat(countedCash);
  const expected = session?.expectedCash ?? 0;
  const previewVariance = countedCash !== '' && !Number.isNaN(counted) ? counted - expected : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            Cash Drawer
          </DialogTitle>
          <DialogDescription>
            {session ? 'Count the till to close this session.' : 'Open a drawer to start a shift.'}
          </DialogDescription>
        </DialogHeader>

        {isPending ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <p className="py-6 text-sm text-destructive">
            {getErrorMessage(error, 'Could not load the drawer.')}
          </p>
        ) : session ? (
          <div className="space-y-4 py-2">
            <dl className="space-y-2 rounded-md bg-secondary/30 p-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Opened by</dt>
                <dd>{session.openedByName ?? 'Unknown'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Opening float</dt>
                <dd className="tabular-nums">${session.openingFloat.toFixed(2)}</dd>
              </div>
              <div className="flex justify-between font-medium">
                <dt>Expected in drawer</dt>
                <dd className="tabular-nums">${expected.toFixed(2)}</dd>
              </div>
            </dl>

            <div className="space-y-2">
              <Label htmlFor="countedCash">Counted cash</Label>
              <Input
                id="countedCash"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="What is actually in the drawer"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
              />
            </div>

            {previewVariance !== null && (
              <div
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  previewVariance === 0
                    ? 'bg-accent/10'
                    : previewVariance < 0
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-accent/10'
                }`}
              >
                {previewVariance === 0
                  ? 'Balances exactly'
                  : `${previewVariance < 0 ? 'Short' : 'Over'} by $${Math.abs(previewVariance).toFixed(2)}`}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="drawerNotes">Notes (optional)</Label>
              <Textarea
                id="drawerNotes"
                rows={2}
                placeholder="Anything worth recording about this shift"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2 py-2">
            <Label htmlFor="openingFloat">Opening float</Label>
            <Input
              id="openingFloat"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="0.00"
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The cash already in the drawer before trading starts.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {session ? (
            <Button
              onClick={() => closeDrawer.mutate()}
              disabled={countedCash === '' || closeDrawer.isPending}
            >
              {closeDrawer.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Close Drawer
            </Button>
          ) : (
            <Button onClick={() => openDrawer.mutate()} disabled={openDrawer.isPending}>
              {openDrawer.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Open Drawer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
