import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import {
  webhooksApi,
  type WebhookDelivery,
  type WebhookDeliveryStatus,
  type WebhookSubscription,
  type WebhookSubscriptionWithSecret,
} from '@/lib/api';
import { Plus, Trash2, Copy, RotateCcw, Send } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/errors';

/** Mirrors the backend event catalog (`services/outbox.ts`). */
const EVENT_TYPES = ['order.created', 'order.refunded', 'customer.created'];
const STATUSES: WebhookDeliveryStatus[] = ['pending', 'delivered', 'failed', 'dead'];

export default function AdminWebhooks() {
  const [subs, setSubs] = useState<WebhookSubscription[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [statusFilter, setStatusFilter] = useState<WebhookDeliveryStatus | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [formUrl, setFormUrl] = useState('');
  const [formEvents, setFormEvents] = useState<string[]>([EVENT_TYPES[0]]);
  // Held only until the dialog is dismissed; the server cannot show it again.
  const [revealed, setRevealed] = useState<WebhookSubscriptionWithSecret | null>(null);
  const { toast } = useToast();

  const fail = useCallback(
    (error: unknown, fallback: string) =>
      toast({ title: 'Error', description: getErrorMessage(error, fallback), variant: 'destructive' }),
    [toast]
  );

  const loadSubs = useCallback(async () => {
    try {
      setSubs(await webhooksApi.list());
    } catch (error: unknown) {
      fail(error, 'Failed to load webhooks');
    }
  }, [fail]);

  const loadDeliveries = useCallback(async () => {
    try {
      setDeliveries(await webhooksApi.deliveries(statusFilter));
    } catch (error: unknown) {
      fail(error, 'Failed to load deliveries');
    }
  }, [fail, statusFilter]);

  useEffect(() => {
    void loadSubs();
  }, [loadSubs]);
  useEffect(() => {
    void loadDeliveries();
  }, [loadDeliveries]);

  const handleCreate = async () => {
    if (!formUrl.trim() || formEvents.length === 0) {
      toast({ title: 'A URL and at least one event are required', variant: 'destructive' });
      return;
    }
    try {
      setRevealed(await webhooksApi.create({ url: formUrl.trim(), events: formEvents }));
      setCreateOpen(false);
      setFormUrl('');
      setFormEvents([EVENT_TYPES[0]]);
      await loadSubs();
    } catch (error: unknown) {
      fail(error, 'Failed to create webhook');
    }
  };

  const handleRotate = async (sub: WebhookSubscription) => {
    if (!confirm('Rotate the secret? The old one keeps working for 24 hours.')) return;
    try {
      setRevealed(await webhooksApi.rotateSecret(sub.id));
      await loadSubs();
    } catch (error: unknown) {
      fail(error, 'Failed to rotate secret');
    }
  };

  const handleDelete = async (sub: WebhookSubscription) => {
    if (!confirm('Delete this webhook? Its delivery history is removed too.')) return;
    try {
      await webhooksApi.remove(sub.id);
      await Promise.all([loadSubs(), loadDeliveries()]);
    } catch (error: unknown) {
      fail(error, 'Failed to delete webhook');
    }
  };

  const handleToggle = async (sub: WebhookSubscription) => {
    try {
      await webhooksApi.update(sub.id, { active: !sub.active });
      await loadSubs();
    } catch (error: unknown) {
      fail(error, 'Failed to update webhook');
    }
  };

  const handleRedeliver = async (delivery: WebhookDelivery) => {
    try {
      await webhooksApi.redeliver(delivery.id);
      toast({ title: 'Queued for redelivery' });
      await loadDeliveries();
    } catch (error: unknown) {
      fail(error, 'Failed to redeliver');
    }
  };

  const toggleEvent = (type: string, checked: boolean) =>
    setFormEvents((prev) => (checked ? [...prev, type] : prev.filter((t) => t !== type)));

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Webhooks</h1>
            <p className="text-muted-foreground">Send signed events to other systems</p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add webhook
          </Button>
        </div>

        <Tabs defaultValue="subscriptions" className="space-y-6">
          <TabsList>
            <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
            <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
          </TabsList>

          <TabsContent value="subscriptions">
            <Card>
              <CardHeader>
                <CardTitle>Subscriptions</CardTitle>
                <CardDescription>
                  Private-network addresses are refused unless listed in the webhook allow-list.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>URL</TableHead>
                      <TableHead>Events</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          No webhooks yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      subs.map((sub) => (
                        <TableRow key={sub.id} className={sub.active ? '' : 'opacity-50'}>
                          <TableCell className="font-mono text-sm break-all">{sub.url}</TableCell>
                          <TableCell>{sub.events.join(', ')}</TableCell>
                          <TableCell>
                            <Badge variant={sub.active ? 'default' : 'secondary'}>
                              {sub.active ? 'Active' : 'Disabled'}
                            </Badge>
                            {sub.rotating && <Badge variant="outline" className="ml-1">Rotating</Badge>}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" onClick={() => handleToggle(sub)}>
                                {sub.active ? 'Disable' : 'Enable'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Rotate secret for ${sub.url}`}
                                onClick={() => handleRotate(sub)}
                              >
                                <RotateCcw className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Delete ${sub.url}`}
                                onClick={() => handleDelete(sub)}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="deliveries">
            <Card>
              <CardHeader>
                <CardTitle>Delivery log</CardTitle>
                <div className="flex gap-2 pt-2">
                  <Button variant={statusFilter ? 'outline' : 'default'} size="sm" onClick={() => setStatusFilter(undefined)}>
                    All
                  </Button>
                  {STATUSES.map((s) => (
                    <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Last result</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deliveries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No deliveries.
                        </TableCell>
                      </TableRow>
                    ) : (
                      deliveries.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell>{d.eventType}</TableCell>
                          <TableCell>{d.status}</TableCell>
                          <TableCell>{d.attempts}</TableCell>
                          <TableCell className="text-sm">
                            {d.lastError ?? (d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : '')}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Redeliver ${d.eventType}`}
                              onClick={() => handleRedeliver(d)}
                            >
                              <Send className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add webhook</DialogTitle>
              <DialogDescription>Events are POSTed to this URL, signed with a secret shown once.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="webhook-url">URL</Label>
                <Input
                  id="webhook-url"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://example.com/hooks/steward"
                />
              </div>
              <div className="space-y-2">
                <Label>Events</Label>
                {EVENT_TYPES.map((type) => (
                  <div key={type} className="flex items-center gap-2">
                    <Checkbox
                      id={`event-${type}`}
                      checked={formEvents.includes(type)}
                      onCheckedChange={(checked) => toggleEvent(type, checked === true)}
                    />
                    <Label htmlFor={`event-${type}`} className="cursor-pointer font-mono text-sm">{type}</Label>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={revealed !== null} onOpenChange={(open) => !open && setRevealed(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Signing secret</DialogTitle>
              <DialogDescription>
                Copy it now. It is shown only once and cannot be retrieved later.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Input value={revealed?.secret ?? ''} readOnly aria-label="Secret value" className="font-mono text-sm" />
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy secret"
                onClick={() => {
                  void navigator.clipboard.writeText(revealed?.secret ?? '');
                  toast({ title: 'Copied to clipboard' });
                }}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => setRevealed(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
