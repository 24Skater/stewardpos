import { useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import AdminLayout from '@/components/AdminLayout';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { useSession } from '@/hooks/queries/useSession';
import {
  useCreateLocation,
  useCreateRegister,
  useDisableRegister,
  useActivateRegister,
  useGeneratePairingCode,
  useLocations,
  useRegisters,
  useRetireRegister,
  useRevokeRegister,
  useUpdateRegister,
} from '@/hooks/queries/useRegisters';
import { authApi } from '@/lib/api';
import { authStore, writeAssumedSession } from '@/lib/auth-store';
import { hasPermission } from '@/lib/auth';
import { getErrorMessage } from '@/lib/errors';
import { ApiClientError } from '@/lib/api-client';
import type {
  Location,
  Register,
  RegisterLiveness,
  RegisterPairingCode,
  RegisterStatus,
  RegisterType,
} from '@/lib/api';
import {
  Ban,
  Copy,
  KeyRound,
  Loader2,
  LogIn,
  MapPin,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Store,
  Trash2,
  Unlink,
} from 'lucide-react';

/** Every register status a manager can filter by, `all` first. */
const STATUS_FILTERS: Array<{ value: RegisterStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending setup' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'retired', label: 'Retired' },
];

/**
 * Status badge variants, reusing the badge component's own variants rather
 * than introducing new colours. Each variant carries its own text label —
 * see the render below — so status is never conveyed by colour alone.
 */
const STATUS_BADGE: Record<RegisterStatus, { label: string; variant: BadgeProps['variant'] }> = {
  active: { label: 'Active', variant: 'default' },
  pending: { label: 'Pending setup', variant: 'outline' },
  disabled: { label: 'Disabled', variant: 'secondary' },
  retired: { label: 'Retired', variant: 'destructive' },
};

const REGISTER_TYPE_LABELS: Record<RegisterType, string> = {
  fixed: 'Fixed',
  mobile: 'Mobile',
  web: 'Web',
  kiosk: 'Kiosk',
};

/**
 * Liveness badge variants, same rule as `STATUS_BADGE` above: every variant
 * carries its own text label, so liveness is never conveyed by colour alone.
 * `never` (no heartbeat has ever landed) is kept visually distinct from
 * `offline` (one landed, then stopped) — they mean different things to an
 * operator deciding whether a till needs attention.
 */
const LIVENESS_BADGE: Record<RegisterLiveness, { label: string; variant: BadgeProps['variant'] }> = {
  online: { label: 'Online', variant: 'default' },
  idle: { label: 'Idle', variant: 'secondary' },
  offline: { label: 'Offline', variant: 'destructive' },
  never: { label: 'Never seen', variant: 'outline' },
};

/** Form state for both creating and editing a register. Location only applies to create. */
interface RegisterFormState {
  locationId: string;
  name: string;
  placement: string;
  type: RegisterType;
  hasCashDrawer: boolean;
  acceptsCash: boolean;
  canRefund: boolean;
  canOpenDrawerNoSale: boolean;
  requireSignIn: boolean;
  idleLockSeconds: number;
}

function emptyRegisterForm(locationId = ''): RegisterFormState {
  return {
    locationId,
    name: '',
    placement: '',
    type: 'fixed',
    hasCashDrawer: true,
    acceptsCash: true,
    canRefund: true,
    canOpenDrawerNoSale: false,
    requireSignIn: false,
    idleLockSeconds: 300,
  };
}

interface LocationFormState {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  timezone: string;
}

const emptyLocationForm: LocationFormState = {
  name: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  timezone: 'UTC',
};

function addressLine(location: Location): string {
  const parts = [location.address, location.city, location.state, location.zip].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'No address on file';
}

function formatLastSeen(lastSeenAt: number | null): string {
  if (lastSeenAt == null) return 'Never';
  return formatDistanceToNow(lastSeenAt, { addSuffix: true });
}

/** 'in 15 minutes' — always future-tense at issuance; a code is minted with a fresh 15-minute TTL. */
function formatExpiresAt(expiresAt: number): string {
  return formatDistanceToNow(expiresAt, { addSuffix: true });
}

/**
 * The capabilities that matter at a glance: whether this till can even take
 * cash. A "web / no drawer" register is a first-class configuration this
 * feature exists to support, so that fact has to read from the row itself,
 * not from an expanded detail view.
 */
function RegisterCapabilities({ register }: { register: Register }) {
  const extras = [
    register.acceptsCash && 'Accepts cash',
    register.canRefund && 'Can refund',
    register.canOpenDrawerNoSale && 'No-sale open',
    register.requireSignIn && 'Sign-in required',
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-1">
      {register.hasCashDrawer ? (
        <Badge variant="outline">Cash drawer</Badge>
      ) : (
        <Badge variant="secondary" className="gap-1">
          <Ban className="h-3 w-3" aria-hidden="true" />
          No cash drawer
        </Badge>
      )}
      {extras.length > 0 && <p className="text-xs text-muted-foreground">{extras.join(' · ')}</p>}
    </div>
  );
}

export default function AdminRegisters() {
  const { toast } = useToast();
  const { data: session } = useSession();
  const navigate = useNavigate();

  const canWrite = hasPermission(session ?? null, 'registers', 'write');
  const canDelete = hasPermission(session ?? null, 'registers', 'delete');

  const [assumingId, setAssumingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RegisterStatus | 'all'>('all');
  const locationsQuery = useLocations();
  const registersQuery = useRegisters(statusFilter === 'all' ? undefined : { status: statusFilter });

  const createLocation = useCreateLocation();
  const createRegister = useCreateRegister();
  const updateRegister = useUpdateRegister();
  const retireRegister = useRetireRegister();
  const disableRegister = useDisableRegister();
  const activateRegister = useActivateRegister();
  const generatePairingCode = useGeneratePairingCode();
  const revokeRegister = useRevokeRegister();

  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [locationForm, setLocationForm] = useState<LocationFormState>(emptyLocationForm);

  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  const [editingRegister, setEditingRegister] = useState<Register | null>(null);
  const [registerForm, setRegisterForm] = useState<RegisterFormState>(emptyRegisterForm());

  const [retireTarget, setRetireTarget] = useState<Register | null>(null);

  // Pairing code: the register it was minted for, plus the code itself. The
  // code is shown exactly once (the backend only ever stores a hash of it),
  // so there is nothing to re-fetch if this dialog is closed.
  const [pairingCodeTarget, setPairingCodeTarget] = useState<Register | null>(null);
  const [pairingCodeResult, setPairingCodeResult] = useState<RegisterPairingCode | null>(null);

  // Revoke is a two-step confirmation: the plain confirm below, and — only
  // reached if the backend answers 409 for an open drawer — a second,
  // starker confirmation that explains the drawer will be force-closed.
  const [revokeTarget, setRevokeTarget] = useState<Register | null>(null);
  const [forceRevokeTarget, setForceRevokeTarget] = useState<{ register: Register; message: string } | null>(
    null
  );

  const locations = locationsQuery.data ?? [];
  const registers = registersQuery.data ?? [];
  const activeLocations = locations.filter((l) => l.status === 'active');

  const registersByLocation = useMemo(() => {
    const map = new Map<string, Register[]>();
    for (const register of registersQuery.data ?? []) {
      const list = map.get(register.locationId) ?? [];
      list.push(register);
      map.set(register.locationId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.registerNumber - b.registerNumber);
    }
    return map;
  }, [registersQuery.data]);

  const isLoading = locationsQuery.isPending || registersQuery.isPending;
  const loadError = locationsQuery.error ?? registersQuery.error;

  const openCreateRegister = (locationId?: string) => {
    setEditingRegister(null);
    setRegisterForm(emptyRegisterForm(locationId ?? activeLocations[0]?.id ?? ''));
    setRegisterDialogOpen(true);
  };

  const openEditRegister = (register: Register) => {
    setEditingRegister(register);
    setRegisterForm({
      locationId: register.locationId,
      name: register.name,
      placement: register.placement ?? '',
      type: register.type,
      hasCashDrawer: register.hasCashDrawer,
      acceptsCash: register.acceptsCash,
      canRefund: register.canRefund,
      canOpenDrawerNoSale: register.canOpenDrawerNoSale,
      requireSignIn: register.requireSignIn,
      idleLockSeconds: register.idleLockSeconds,
    });
    setRegisterDialogOpen(true);
  };

  const handleSaveLocation = async () => {
    if (!locationForm.name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }

    try {
      await createLocation.mutateAsync({
        name: locationForm.name.trim(),
        address: locationForm.address.trim() || null,
        city: locationForm.city.trim() || null,
        state: locationForm.state.trim() || null,
        zip: locationForm.zip.trim() || null,
        timezone: locationForm.timezone.trim() || undefined,
      });
      toast({ title: 'Location created' });
      setLocationDialogOpen(false);
      setLocationForm(emptyLocationForm);
    } catch (error: unknown) {
      toast({
        title: 'Failed to create location',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    }
  };

  const handleSaveRegister = async () => {
    if (!registerForm.name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    if (!editingRegister && !registerForm.locationId) {
      toast({ title: 'Choose a location', variant: 'destructive' });
      return;
    }

    const body = {
      name: registerForm.name.trim(),
      placement: registerForm.placement.trim() || null,
      type: registerForm.type,
      hasCashDrawer: registerForm.hasCashDrawer,
      acceptsCash: registerForm.acceptsCash,
      canRefund: registerForm.canRefund,
      canOpenDrawerNoSale: registerForm.canOpenDrawerNoSale,
      requireSignIn: registerForm.requireSignIn,
      idleLockSeconds: registerForm.idleLockSeconds,
    };

    try {
      if (editingRegister) {
        await updateRegister.mutateAsync({ id: editingRegister.id, body });
        toast({ title: 'Register updated' });
      } else {
        await createRegister.mutateAsync({ locationId: registerForm.locationId, ...body });
        toast({ title: 'Register created' });
      }
      setRegisterDialogOpen(false);
      setEditingRegister(null);
    } catch (error: unknown) {
      // The org's register cap is a manager-actionable fact, not a generic
      // failure — it says what the limit is, so the toast has to say it too
      // rather than falling back to "Failed to create register".
      if (error instanceof ApiClientError && error.status === 422) {
        toast({ title: 'Register limit reached', description: error.message, variant: 'destructive' });
        return;
      }
      toast({
        title: editingRegister ? 'Failed to update register' : 'Failed to create register',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    }
  };

  const handleDisable = async (register: Register) => {
    try {
      await disableRegister.mutateAsync(register.id);
      toast({ title: `${register.displayCode} disabled` });
    } catch (error: unknown) {
      toast({ title: 'Failed to disable register', description: getErrorMessage(error), variant: 'destructive' });
    }
  };

  const handleActivate = async (register: Register) => {
    try {
      await activateRegister.mutateAsync(register.id);
      toast({ title: `${register.displayCode} activated` });
    } catch (error: unknown) {
      toast({ title: 'Failed to activate register', description: getErrorMessage(error), variant: 'destructive' });
    }
  };

  const handleConfirmRetire = async () => {
    if (!retireTarget) return;
    const target = retireTarget;
    try {
      await retireRegister.mutateAsync(target.id);
      toast({ title: `${target.displayCode} retired` });
    } catch (error: unknown) {
      toast({ title: 'Failed to retire register', description: getErrorMessage(error), variant: 'destructive' });
    } finally {
      setRetireTarget(null);
    }
  };

  /**
   * Open a till from the back office, without this browser being paired.
   *
   * The one path to a till session that skips the device credential, which is
   * why the server audits it and caps it at thirty minutes. Sales ring up
   * against the admin, not against any cashier being covered — the POS banner
   * says so, which is why the record is written here and not left implicit.
   *
   * The token and the record go together or not at all: a token without the
   * record would put an admin on a till with nothing telling them their name is
   * on every sale.
   */
  const handleAssume = async (register: Register) => {
    setAssumingId(register.id);
    try {
      const assumed = await authApi.assumeTill({ registerId: register.id });
      authStore.setToken(assumed.token, assumed.expiresIn);
      writeAssumedSession({
        adminName: session?.user.name ?? 'An administrator',
        actingAs: assumed.actingAs?.name ?? null,
      });
      navigate('/pos');
    } catch (error: unknown) {
      toast({
        title: 'Could not open that register',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setAssumingId(null);
    }
  };

  const handleGeneratePairingCode = async (register: Register) => {
    try {
      const result = await generatePairingCode.mutateAsync(register.id);
      setPairingCodeTarget(register);
      setPairingCodeResult(result);
    } catch (error: unknown) {
      toast({
        title: 'Failed to generate pairing code',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    }
  };

  const copyPairingCode = () => {
    if (!pairingCodeResult) return;
    navigator.clipboard.writeText(pairingCodeResult.formattedCode);
    toast({ title: 'Copied to clipboard' });
  };

  /**
   * First confirmation. A 409 here means the register has an open drawer
   * session — that isn't a failure to report, it's the backend asking
   * whether to force the issue, so it routes to the second confirmation
   * instead of a toast.
   */
  const handleConfirmRevoke = async () => {
    if (!revokeTarget) return;
    const target = revokeTarget;
    try {
      await revokeRegister.mutateAsync({ id: target.id });
      toast({
        title: `${target.displayCode} revoked`,
        description: 'The device stopped working immediately. Re-pairing is required before it can take a sale again.',
      });
      setRevokeTarget(null);
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 409) {
        setRevokeTarget(null);
        setForceRevokeTarget({ register: target, message: error.message });
        return;
      }
      toast({ title: 'Failed to revoke register', description: getErrorMessage(error), variant: 'destructive' });
      setRevokeTarget(null);
    }
  };

  /** Second confirmation, reached only after the 409 above. Closes the open drawer as part of the revoke. */
  const handleConfirmForceRevoke = async () => {
    if (!forceRevokeTarget) return;
    const target = forceRevokeTarget.register;
    try {
      await revokeRegister.mutateAsync({ id: target.id, body: { force: true } });
      toast({
        title: `${target.displayCode} revoked`,
        description: 'Its open drawer was closed at its expected cash and flagged for review.',
      });
    } catch (error: unknown) {
      toast({ title: 'Failed to revoke register', description: getErrorMessage(error), variant: 'destructive' });
    } finally {
      setForceRevokeTarget(null);
    }
  };

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Registers</h1>
            <p className="text-muted-foreground">
              {locations.length} location{locations.length === 1 ? '' : 's'} · {registers.length} register
              {registers.length === 1 ? '' : 's'}
            </p>
          </div>
          {canWrite && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setLocationDialogOpen(true)}>
                <MapPin className="w-4 h-4 mr-2" aria-hidden="true" />
                Add Location
              </Button>
              <Button onClick={() => openCreateRegister()} disabled={activeLocations.length === 0}>
                <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                Add Register
              </Button>
            </div>
          )}
        </div>

        <div className="mb-6 max-w-xs">
          <Label htmlFor="registers-status-filter">Filter by status</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as RegisterStatus | 'all')}>
            <SelectTrigger id="registers-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loadError ? (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <p className="text-muted-foreground">
                {getErrorMessage(loadError, 'Could not load the register estate')}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  locationsQuery.refetch();
                  registersQuery.refetch();
                }}
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="flex justify-center py-16" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="sr-only">Loading registers…</span>
          </div>
        ) : locations.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No locations yet. {canWrite && 'Add one to start enrolling registers.'}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {locations.map((location) => {
              const locationRegisters = registersByLocation.get(location.id) ?? [];

              return (
                <Card key={location.id}>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <Store className="h-5 w-5 mt-1 text-muted-foreground" aria-hidden="true" />
                        <div>
                          <h2 className="text-2xl font-semibold leading-none tracking-tight">{location.name}</h2>
                          <p className="text-sm text-muted-foreground mt-1">{addressLine(location)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {location.registerCount ?? 0} register{(location.registerCount ?? 0) === 1 ? '' : 's'}
                        </Badge>
                        {canWrite && location.status === 'active' && (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Add Register at ${location.name}`}
                            onClick={() => openCreateRegister(location.id)}
                          >
                            <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
                            Add Register
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {locationRegisters.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4">
                        {statusFilter === 'all'
                          ? 'No registers at this location yet.'
                          : `No ${STATUS_FILTERS.find((f) => f.value === statusFilter)?.label.toLowerCase()} registers at this location.`}
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Code</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>#</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Capabilities</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Liveness</TableHead>
                            <TableHead>Last seen</TableHead>
                            {(canWrite || canDelete) && <TableHead>Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {locationRegisters.map((register) => {
                            const statusBadge = STATUS_BADGE[register.status];
                            return (
                              <TableRow key={register.id}>
                                <TableCell className="font-mono text-sm">{register.displayCode}</TableCell>
                                <TableCell className="font-medium">{register.name}</TableCell>
                                <TableCell>{register.registerNumber}</TableCell>
                                <TableCell>{REGISTER_TYPE_LABELS[register.type]}</TableCell>
                                <TableCell>
                                  <RegisterCapabilities register={register} />
                                </TableCell>
                                <TableCell>
                                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                                </TableCell>
                                <TableCell>
                                  {(() => {
                                    const liveness = LIVENESS_BADGE[register.liveness ?? 'never'];
                                    return <Badge variant={liveness.variant}>{liveness.label}</Badge>;
                                  })()}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {formatLastSeen(register.lastSeenAt)}
                                </TableCell>
                                {(canWrite || canDelete) && (
                                  <TableCell>
                                    <div className="flex gap-1">
                                      {canWrite && register.status !== 'retired' && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          aria-label={`Edit ${register.displayCode}`}
                                          onClick={() => openEditRegister(register)}
                                        >
                                          <Pencil className="w-4 h-4" aria-hidden="true" />
                                        </Button>
                                      )}
                                      {canWrite && register.status === 'active' && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          aria-label={`Disable ${register.displayCode}`}
                                          onClick={() => handleDisable(register)}
                                        >
                                          <PowerOff className="w-4 h-4" aria-hidden="true" />
                                        </Button>
                                      )}
                                      {canWrite &&
                                        (register.status === 'disabled' || register.status === 'pending') && (
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={`Activate ${register.displayCode}`}
                                            onClick={() => handleActivate(register)}
                                          >
                                            <Power className="w-4 h-4" aria-hidden="true" />
                                          </Button>
                                        )}
                                      {canWrite && register.status === 'active' && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          aria-label={`Open ${register.displayCode}`}
                                          title="Open this register from here"
                                          onClick={() => handleAssume(register)}
                                          disabled={assumingId === register.id}
                                        >
                                          <LogIn className="w-4 h-4" aria-hidden="true" />
                                        </Button>
                                      )}
                                      {canWrite && register.status !== 'retired' && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          aria-label={`Generate pairing code for ${register.displayCode}`}
                                          onClick={() => handleGeneratePairingCode(register)}
                                          disabled={generatePairingCode.isPending}
                                        >
                                          <KeyRound className="w-4 h-4" aria-hidden="true" />
                                        </Button>
                                      )}
                                      {canDelete && register.status !== 'retired' && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="text-destructive"
                                          aria-label={`Revoke ${register.displayCode}`}
                                          onClick={() => setRevokeTarget(register)}
                                        >
                                          <Unlink className="w-4 h-4" aria-hidden="true" />
                                        </Button>
                                      )}
                                      {canDelete && register.status !== 'retired' && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="text-destructive"
                                          aria-label={`Retire ${register.displayCode}`}
                                          onClick={() => setRetireTarget(register)}
                                        >
                                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                                        </Button>
                                      )}
                                    </div>
                                  </TableCell>
                                )}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Add Location Dialog */}
        <Dialog
          open={locationDialogOpen}
          onOpenChange={(open) => {
            setLocationDialogOpen(open);
            if (!open) setLocationForm(emptyLocationForm);
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Location</DialogTitle>
              <DialogDescription>Create a new site to enroll registers at.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="registers-location-name">Name *</Label>
                <Input
                  id="registers-location-name"
                  value={locationForm.name}
                  onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
                  placeholder="e.g., Downtown Store"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="registers-location-address">Address</Label>
                <Input
                  id="registers-location-address"
                  value={locationForm.address}
                  onChange={(e) => setLocationForm({ ...locationForm, address: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="registers-location-city">City</Label>
                  <Input
                    id="registers-location-city"
                    value={locationForm.city}
                    onChange={(e) => setLocationForm({ ...locationForm, city: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="registers-location-state">State</Label>
                  <Input
                    id="registers-location-state"
                    value={locationForm.state}
                    onChange={(e) => setLocationForm({ ...locationForm, state: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="registers-location-zip">ZIP</Label>
                  <Input
                    id="registers-location-zip"
                    value={locationForm.zip}
                    onChange={(e) => setLocationForm({ ...locationForm, zip: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="registers-location-timezone">Timezone</Label>
                <Input
                  id="registers-location-timezone"
                  value={locationForm.timezone}
                  onChange={(e) => setLocationForm({ ...locationForm, timezone: e.target.value })}
                  placeholder="UTC"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setLocationDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveLocation} disabled={createLocation.isPending}>
                {createLocation.isPending ? 'Creating…' : 'Create Location'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add/Edit Register Dialog */}
        <Dialog
          open={registerDialogOpen}
          onOpenChange={(open) => {
            setRegisterDialogOpen(open);
            if (!open) {
              setEditingRegister(null);
              setRegisterForm(emptyRegisterForm());
            }
          }}
        >
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingRegister ? 'Edit Register' : 'Add Register'}</DialogTitle>
              <DialogDescription>
                {editingRegister
                  ? `Update ${editingRegister.displayCode}'s details and capabilities.`
                  : 'Enroll a new till at a location.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {!editingRegister && (
                <div className="space-y-2">
                  <Label htmlFor="registers-register-location">Location *</Label>
                  <Select
                    value={registerForm.locationId}
                    onValueChange={(v) => setRegisterForm({ ...registerForm, locationId: v })}
                  >
                    <SelectTrigger id="registers-register-location">
                      <SelectValue placeholder="Select a location" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeLocations.map((location) => (
                        <SelectItem key={location.id} value={location.id}>
                          {location.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="registers-register-name">Name *</Label>
                <Input
                  id="registers-register-name"
                  value={registerForm.name}
                  onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                  placeholder="e.g., Front Counter"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="registers-register-placement">Placement</Label>
                <Input
                  id="registers-register-placement"
                  value={registerForm.placement}
                  onChange={(e) => setRegisterForm({ ...registerForm, placement: e.target.value })}
                  placeholder="e.g., 1st floor coffee shop"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={registerForm.type}
                    onValueChange={(v: RegisterType) => setRegisterForm({ ...registerForm, type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(REGISTER_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="registers-register-idle">Idle lock (seconds)</Label>
                  <Input
                    id="registers-register-idle"
                    type="number"
                    min="1"
                    value={registerForm.idleLockSeconds}
                    onChange={(e) =>
                      setRegisterForm({ ...registerForm, idleLockSeconds: parseInt(e.target.value, 10) || 1 })
                    }
                  />
                </div>
              </div>

              {/* Register number and display code are server-generated — see
                  services/registers.ts. Shown here so the form isn't silent
                  about them, but never as an editable field. */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="registers-register-number">Register number</Label>
                  <Input
                    id="registers-register-number"
                    value={editingRegister ? String(editingRegister.registerNumber) : ''}
                    placeholder="Assigned automatically"
                    disabled
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="registers-register-code">Display code</Label>
                  <Input
                    id="registers-register-code"
                    value={editingRegister ? editingRegister.displayCode : ''}
                    placeholder="Assigned automatically"
                    disabled
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The register number and display code are assigned automatically from the location and the next
                available number when the register is created. They can't be edited here.
              </p>

              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Has cash drawer</Label>
                    <p className="text-xs text-muted-foreground">Off for a web or app-only register</p>
                  </div>
                  <Switch
                    checked={registerForm.hasCashDrawer}
                    onCheckedChange={(v) => setRegisterForm({ ...registerForm, hasCashDrawer: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Accepts cash</Label>
                  <Switch
                    checked={registerForm.acceptsCash}
                    onCheckedChange={(v) => setRegisterForm({ ...registerForm, acceptsCash: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Can refund</Label>
                  <Switch
                    checked={registerForm.canRefund}
                    onCheckedChange={(v) => setRegisterForm({ ...registerForm, canRefund: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Can open drawer without a sale</Label>
                    <p className="text-xs text-muted-foreground">For making change or paid-outs</p>
                  </div>
                  <Switch
                    checked={registerForm.canOpenDrawerNoSale}
                    onCheckedChange={(v) => setRegisterForm({ ...registerForm, canOpenDrawerNoSale: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Require sign-in</Label>
                  <Switch
                    checked={registerForm.requireSignIn}
                    onCheckedChange={(v) => setRegisterForm({ ...registerForm, requireSignIn: v })}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRegisterDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveRegister}
                disabled={createRegister.isPending || updateRegister.isPending}
              >
                {createRegister.isPending || updateRegister.isPending
                  ? 'Saving…'
                  : editingRegister
                    ? 'Save Changes'
                    : 'Create Register'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Retire confirmation */}
        <AlertDialog open={retireTarget != null} onOpenChange={(open) => !open && setRetireTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Retire {retireTarget?.displayCode}?</AlertDialogTitle>
              <AlertDialogDescription>
                Retiring this register is permanent. Its register number and display code will never be reused —
                even by a replacement till — so an old receipt always resolves back to the till that printed it.
                This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleConfirmRetire}
              >
                Retire register
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Pairing code display */}
        <Dialog
          open={pairingCodeResult != null}
          onOpenChange={(open) => {
            if (!open) {
              setPairingCodeResult(null);
              setPairingCodeTarget(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Pairing code for {pairingCodeTarget?.displayCode}</DialogTitle>
              <DialogDescription>
                Enter this code on the till's own screen at <span className="font-mono">/pair</span> to enrol it.
                This code is shown once — it won't be shown again.
              </DialogDescription>
            </DialogHeader>
            {pairingCodeResult && (
              <div className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg text-sm">
                  <strong>Important:</strong> This is the only time you'll see this code. If you lose it, generate
                  a new one — the old code stops working the moment a new one is issued.
                </div>
                <div className="flex items-center justify-center gap-2">
                  <span className="font-mono text-3xl font-bold tracking-[0.2em] text-foreground">
                    {pairingCodeResult.formattedCode}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Copy pairing code"
                    onClick={copyPairingCode}
                  >
                    <Copy className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  Expires {formatExpiresAt(pairingCodeResult.expiresAt)}
                </p>
              </div>
            )}
            <DialogFooter>
              <Button
                onClick={() => {
                  setPairingCodeResult(null);
                  setPairingCodeTarget(null);
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Revoke confirmation */}
        <AlertDialog open={revokeTarget != null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke {revokeTarget?.displayCode}?</AlertDialogTitle>
              <AlertDialogDescription>
                This immediately stops the device from authenticating as {revokeTarget?.displayCode} — its very
                next request is rejected. The register returns to pending, and it must be paired again with a new
                code before it can take a sale. This is not the same as disabling it: disabling can be undone
                instantly, this cannot — the device has to be re-paired from the till itself.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleConfirmRevoke}
              >
                Revoke register
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Force-revoke confirmation: reached only after a 409 for an open drawer. */}
        <AlertDialog
          open={forceRevokeTarget != null}
          onOpenChange={(open) => !open && setForceRevokeTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{forceRevokeTarget?.register.displayCode} has an open cash drawer</AlertDialogTitle>
              <AlertDialogDescription>
                {forceRevokeTarget?.message} Forcing this revoke will close that drawer at its expected cash and
                flag it for review — nobody counts it first, so this will likely create a cash variance that has
                to be investigated later. Do this only if the till is gone or unreachable.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleConfirmForceRevoke}
              >
                Close drawer and revoke
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AdminLayout>
  );
}
