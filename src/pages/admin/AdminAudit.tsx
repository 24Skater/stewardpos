import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminApi, type AuditQuery } from '@/lib/api';
import { Eye, RefreshCw } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/errors';
import { diffRecords, formatValue } from '@/lib/audit-diff';
import { describeActor } from '@/lib/audit-actor';

interface AuditLog {
  id: string;
  timestamp: number;
  userId: string | null;
  userName?: string;
  userEmail?: string;
  /**
   * Set when no person performed the action: a terminal redeeming a pairing
   * code, or an API key. Reads `api-key:<name>` or `register:<id>` — see
   * `services/audit.ts`.
   */
  actorLabel?: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * The entities and actions the server records.
 *
 * A fixed list rather than one derived from the loaded page: deriving it would
 * offer only the values that happen to appear in the rows currently on screen,
 * so the filter for the thing you are looking for disappears exactly when you
 * have paged away from it.
 */
const ENTITIES = [
  'product',
  'category',
  'order',
  'return',
  'customer',
  'service',
  'quote',
  'user',
  'role',
  'settings',
  'discount',
  'promo_code',
  'api_key',
  'location',
  'register',
  'register_credential',
  'register_shift',
  'register_override',
];
const ACTIONS = ['create', 'update', 'delete', 'archive', 'refund', 'restock'];


const PAGE_SIZE = 50;

/** The sentinel for "no filter"; Radix Select cannot hold an empty value. */
const ANY = 'any';

export default function AdminAudit() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [entity, setEntity] = useState(ANY);
  const [action, setAction] = useState(ANY);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const { toast } = useToast();

  /**
   * Every filter goes to the server.
   *
   * This screen used to fetch the newest hundred entries and filter them in the
   * browser, so its search box searched one page of the audit log while looking
   * like it searched the log — which is a bad way to find out who deleted
   * something last month.
   */
  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);

      const query: AuditQuery = { limit: PAGE_SIZE, offset };
      if (entity !== ANY) query.entity = entity;
      if (action !== ANY) query.action = action;
      if (from) query.from = Date.parse(`${from}T00:00:00.000Z`);
      if (to) query.to = Date.parse(`${to}T23:59:59.999Z`);

      const { data, meta } = await adminApi.audit(query);
      setLogs(data);
      setTotal(meta?.total ?? data.length);
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: getErrorMessage(error, 'Failed to load audit logs'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [offset, entity, action, from, to, toast]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  /** Changing a filter returns to the first page; page 4 of a new filter is meaningless. */
  const changeFilter = (apply: () => void) => {
    setOffset(0);
    apply();
  };

  const formatDate = (timestamp: number) => new Date(timestamp).toLocaleString();

  const getActionBadgeVariant = (value: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (value.toLowerCase().includes('delete')) return 'destructive';
    if (value.toLowerCase().includes('create')) return 'default';
    if (value.toLowerCase().includes('update')) return 'secondary';
    return 'outline';
  };

  const changes = selectedLog ? diffRecords(selectedLog.before, selectedLog.after) : [];
  const shown = total === 0 ? 0 : offset + 1;
  const lastShown = offset + logs.length;

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Audit Log</h1>
            <p className="text-muted-foreground">Track system changes and user actions</p>
          </div>
          <Button variant="outline" onClick={() => void loadLogs()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <div className="mb-6 flex flex-wrap items-end gap-4">
          <div className="grid gap-1">
            <Label htmlFor="audit-entity" className="text-xs text-muted-foreground">
              Entity
            </Label>
            <Select value={entity} onValueChange={(value) => changeFilter(() => setEntity(value))}>
              <SelectTrigger id="audit-entity" className="w-44">
                <SelectValue placeholder="Any entity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any entity</SelectItem>
                {ENTITIES.map((value) => (
                  <SelectItem key={value} value={value} className="capitalize">
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="audit-action" className="text-xs text-muted-foreground">
              Action
            </Label>
            <Select value={action} onValueChange={(value) => changeFilter(() => setAction(value))}>
              <SelectTrigger id="audit-action" className="w-44">
                <SelectValue placeholder="Any action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any action</SelectItem>
                {ACTIONS.map((value) => (
                  <SelectItem key={value} value={value} className="capitalize">
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="audit-from" className="text-xs text-muted-foreground">
              From
            </Label>
            <Input
              id="audit-from"
              type="date"
              className="w-40"
              max={to || undefined}
              value={from}
              onChange={(e) => changeFilter(() => setFrom(e.target.value))}
            />
          </div>

          <div className="grid gap-1">
            <Label htmlFor="audit-to" className="text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id="audit-to"
              type="date"
              className="w-40"
              min={from || undefined}
              value={to}
              onChange={(e) => changeFilter(() => setTo(e.target.value))}
            />
          </div>

          <Button
            variant="ghost"
            onClick={() =>
              changeFilter(() => {
                setEntity(ANY);
                setAction(ANY);
                setFrom('');
                setTo('');
              })
            }
          >
            Clear filters
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Entity ID</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center">
                    Loading audit logs...
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No audit entries match these filters
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm">{formatDate(log.timestamp)}</TableCell>
                    <TableCell>
                      <div>
                        <span className="font-medium">{describeActor(log)}</span>
                        {log.userEmail && (
                          <p className="text-xs text-muted-foreground">{log.userEmail}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getActionBadgeVariant(log.action)}>{log.action}</Badge>
                    </TableCell>
                    <TableCell className="capitalize">{log.entity}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {log.entityId?.substring(0, 8)}…
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`View the ${log.action} of ${log.entity}`}
                        onClick={() => setSelectedLog(log)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {total === 0 ? 'No entries' : `Showing ${shown}–${lastShown} of ${total}`}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={lastShown >= total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>

        <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Audit Log Details</DialogTitle>
              <DialogDescription>What changed, and who changed it</DialogDescription>
            </DialogHeader>
            {selectedLog && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Timestamp</p>
                    <p>{formatDate(selectedLog.timestamp)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">User</p>
                    <p>{describeActor(selectedLog)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Action</p>
                    <Badge variant={getActionBadgeVariant(selectedLog.action)}>
                      {selectedLog.action}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Entity</p>
                    <p className="capitalize">{selectedLog.entity}</p>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">Entity ID</p>
                  <p className="font-mono text-sm">{selectedLog.entityId}</p>
                </div>

                {/*
                  The changed fields, not the two snapshots.
                  A product carries twenty fields; printing both records whole
                  means reading forty lines to find the one number that moved,
                  which is the only thing anyone opens this to see.
                */}
                <div>
                  <p className="mb-2 text-sm font-medium text-muted-foreground">What changed</p>
                  {changes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No field-level detail was recorded for this entry.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Field</TableHead>
                          <TableHead>Before</TableHead>
                          <TableHead>After</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {changes.map((change) => (
                          <TableRow key={change.field}>
                            <TableCell className="font-medium">{change.field}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {formatValue(change.before)}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {formatValue(change.after)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
