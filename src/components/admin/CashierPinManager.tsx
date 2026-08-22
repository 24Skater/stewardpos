import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { adminApi } from '@/lib/api';
import type { User } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/errors';
import { useToast } from '@/hooks/use-toast';
import { KeyRound, LockOpen, Trash2 } from 'lucide-react';

/**
 * Set or clear a cashier's register sign-on PIN.
 *
 * An existing PIN is never displayed — the backend cannot return one (it only
 * ever stores a bcrypt hash, see `services/pins.ts`), so this screen only
 * ever offers to replace or clear it, never to reveal it.
 *
 * It also clears a lockout. Unlocking is not the same act as reissuing: the
 * cashier's own PIN still works afterwards, which is why the row offers both
 * and why the unlock never touches the PIN itself.
 */

/**
 * Absolute floor, mirrors `MIN_PIN_LENGTH` in `backend/src/services/pins.ts`.
 * The org's actual configured `pin_length` (migration 015, default 6, can be
 * raised per-org) is not currently exposed by `GET /api/admin/settings`, so
 * this form can only enforce the floor, not a stricter org policy — the
 * server remains the real enforcement point either way.
 */
const MIN_PIN_LENGTH = 6;

interface PinDialogState {
  user: User;
  pin: string;
  confirmPin: string;
  submitting: boolean;
  error: string | null;
}

export default function CashierPinManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogState, setDialogState] = useState<PinDialogState | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await adminApi.users.list();
      setUsers(response);
    } catch (error: unknown) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Failed to load staff'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Whether this cashier is locked out *right now*.
   *
   * A past timestamp is not a lockout: the backend clears these lazily, so a
   * lapsed one is the ordinary resting state of someone who simply waited the
   * fifteen minutes out, and offering to unlock it would be offering to do
   * nothing.
   */
  const isLockedOut = (user: User): boolean =>
    user.pinLockedUntil != null && Number(user.pinLockedUntil) > Date.now();

  const handleUnlockPin = async (user: User) => {
    setUnlockingId(user.id);
    try {
      await adminApi.users.unlockPin(user.id);
      toast({ title: `PIN unlocked for ${user.name}`, description: 'Their existing PIN still works.' });
      // Re-read rather than patch the row locally: the lockout is server state,
      // and a local edit would quietly disagree with it the moment anything
      // else changed it.
      await loadUsers();
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: getErrorMessage(error, 'Could not clear the lockout'),
        variant: 'destructive',
      });
    } finally {
      setUnlockingId(null);
    }
  };

  const openSetPin = (user: User) => setDialogState({ user, pin: '', confirmPin: '', submitting: false, error: null });
  const closeDialog = () => setDialogState(null);

  const handleSetPin = async () => {
    if (!dialogState) return;
    const { user, pin, confirmPin } = dialogState;

    if (!/^\d+$/.test(pin)) {
      setDialogState({ ...dialogState, error: 'A PIN must be numbers only.' });
      return;
    }
    if (pin.length < MIN_PIN_LENGTH) {
      setDialogState({ ...dialogState, error: `A PIN must be at least ${MIN_PIN_LENGTH} digits.` });
      return;
    }
    if (pin !== confirmPin) {
      setDialogState({ ...dialogState, error: "The two PINs don't match." });
      return;
    }

    setDialogState({ ...dialogState, submitting: true, error: null });
    try {
      await adminApi.users.setPin(user.id, { pin });
      toast({ title: `PIN set for ${user.name}` });
      closeDialog();
    } catch (error: unknown) {
      // Org-wide uniqueness is enforced server-side (`services/pins.ts#setPin`
      // scans every active PIN holder) and rejected as a conflict — surfaced
      // here in plain language, and deliberately never naming who else holds
      // the colliding PIN.
      const message =
        error instanceof ApiClientError && error.status === 409
          ? 'That PIN is already in use by someone in your organization. Choose a different one.'
          : getErrorMessage(error, 'Could not set the PIN');
      setDialogState((current) => (current ? { ...current, submitting: false, error: message } : current));
    }
  };

  const handleClearPin = async (user: User) => {
    if (
      !confirm(
        `Clear ${user.name}'s PIN? They will not be able to sign on to a register until a new one is set.`
      )
    ) {
      return;
    }

    setClearingId(user.id);
    try {
      await adminApi.users.clearPin(user.id);
      toast({ title: `PIN cleared for ${user.name}` });
    } catch (error: unknown) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Could not clear the PIN'), variant: 'destructive' });
    } finally {
      setClearingId(null);
    }
  };

  return (
    <div className="bg-card rounded-lg border border-border mt-8">
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">Cashier PINs</h2>
        <p className="text-sm text-muted-foreground">
          Set or clear the PIN a cashier uses to sign on to a register. An existing PIN can never be shown here —
          only replaced or cleared.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center py-8">
                Loading staff…
              </TableCell>
            </TableRow>
          ) : users.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                No staff accounts yet.
              </TableCell>
            </TableRow>
          ) : (
            users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell className="text-muted-foreground">{user.email}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    {isLockedOut(user) && (
                      <>
                        <span className="text-sm text-destructive">
                          PIN locked after too many failed attempts
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUnlockPin(user)}
                          disabled={unlockingId === user.id}
                          aria-label={`Unlock PIN for ${user.name}`}
                        >
                          <LockOpen className="w-4 h-4 mr-1" aria-hidden="true" />
                          Unlock
                        </Button>
                      </>
                    )}
                    <Button variant="outline" size="sm" onClick={() => openSetPin(user)}>
                      <KeyRound className="w-4 h-4 mr-1" aria-hidden="true" />
                      Set PIN
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleClearPin(user)}
                      disabled={clearingId === user.id}
                      className="text-destructive"
                      aria-label={`Clear PIN for ${user.name}`}
                    >
                      <Trash2 className="w-4 h-4 mr-1" aria-hidden="true" />
                      Clear PIN
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Dialog open={dialogState !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set PIN{dialogState ? ` for ${dialogState.user.name}` : ''}</DialogTitle>
            <DialogDescription>
              Choose a PIN of at least {MIN_PIN_LENGTH} digits. It cannot be shown again once set — make sure it is
              written down somewhere safe before closing this dialog.
            </DialogDescription>
          </DialogHeader>
          {dialogState && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-pin">New PIN</Label>
                <Input
                  id="new-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={dialogState.pin}
                  onChange={(e) =>
                    setDialogState((current) =>
                      current ? { ...current, pin: e.target.value.replace(/\D/g, '') } : current
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-pin">Confirm PIN</Label>
                <Input
                  id="confirm-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={dialogState.confirmPin}
                  onChange={(e) =>
                    setDialogState((current) =>
                      current ? { ...current, confirmPin: e.target.value.replace(/\D/g, '') } : current
                    )
                  }
                  onKeyDown={(e) => e.key === 'Enter' && handleSetPin()}
                />
              </div>
              {dialogState.error && (
                <p role="alert" className="text-sm text-destructive">
                  {dialogState.error}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={handleSetPin} disabled={dialogState?.submitting}>
              {dialogState?.submitting ? 'Saving…' : 'Save PIN'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
