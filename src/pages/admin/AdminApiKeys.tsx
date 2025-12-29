import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { apiClient } from '@/lib/api-client';
import { Key, Plus, Trash2, Copy, Eye, EyeOff, Code, BookOpen, Shield, Clock, AlertTriangle } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';

interface ApiKey {
  id: string;
  name: string;
  description?: string;
  keyPrefix: string;
  scopes: string[];
  rateLimit: number;
  isActive: boolean;
  lastUsedAt?: number;
  expiresAt?: number;
  createdBy?: string;
  createdByName?: string;
  createdByEmail?: string;
  createdAt: number;
  key?: string; // Only present on creation
}

interface ApiDocs {
  version: string;
  baseUrl: string;
  authentication: any;
  scopes: Record<string, string>;
  rateLimiting: any;
  endpoints: any[];
  examples: any;
  errors: Record<string, string>;
}

const SCOPES = [
  { id: 'read', label: 'Read', description: 'Read access to resources' },
  { id: 'write', label: 'Write', description: 'Create and update resources' },
  { id: 'delete', label: 'Delete', description: 'Delete resources' },
  { id: 'admin', label: 'Admin', description: 'Full administrative access' },
];

export default function AdminApiKeys() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiDocs, setApiDocs] = useState<ApiDocs | null>(null);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newKeyDialogOpen, setNewKeyDialogOpen] = useState(false);
  const [newKey, setNewKey] = useState<ApiKey | null>(null);
  const [showKey, setShowKey] = useState(false);
  
  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formScopes, setFormScopes] = useState<string[]>(['read']);
  const [formRateLimit, setFormRateLimit] = useState(1000);
  
  const { toast } = useToast();

  useEffect(() => {
    loadApiKeys();
    loadApiDocs();
  }, []);

  const loadApiKeys = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<{ success: boolean; data: ApiKey[] }>('/api/admin/api-keys');
      if (response.success) {
        setApiKeys(response.data);
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load API keys',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadApiDocs = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; data: ApiDocs }>('/api/admin/api-keys/docs/reference');
      if (response.success) {
        setApiDocs(response.data);
      }
    } catch (error) {
      console.warn('Could not load API docs');
    }
  };

  const handleCreateKey = async () => {
    if (!formName.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }

    try {
      const response = await apiClient.post<{ success: boolean; data: ApiKey; message: string }>('/api/admin/api-keys', {
        name: formName,
        description: formDescription,
        scopes: formScopes,
        rateLimit: formRateLimit,
      });

      if (response.success) {
        setNewKey(response.data);
        setCreateDialogOpen(false);
        setNewKeyDialogOpen(true);
        resetForm();
        await loadApiKeys();
        toast({ title: 'API key created' });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create API key',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key? Any applications using it will stop working.')) {
      return;
    }

    try {
      const response = await apiClient.delete<{ success: boolean }>(`/api/admin/api-keys/${id}`);
      if (response.success) {
        toast({ title: 'API key revoked' });
        await loadApiKeys();
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to revoke API key',
        variant: 'destructive',
      });
    }
  };

  const handleToggleActive = async (key: ApiKey) => {
    try {
      const response = await apiClient.put<{ success: boolean }>(`/api/admin/api-keys/${key.id}`, {
        isActive: !key.isActive,
      });
      if (response.success) {
        toast({ title: `API key ${key.isActive ? 'disabled' : 'enabled'}` });
        await loadApiKeys();
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormScopes(['read']);
    setFormRateLimit(1000);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard' });
  };

  const getScopeColor = (scope: string) => {
    switch (scope) {
      case 'read': return 'bg-green-100 text-green-800';
      case 'write': return 'bg-blue-100 text-blue-800';
      case 'delete': return 'bg-orange-100 text-orange-800';
      case 'admin': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">API Keys</h1>
              <p className="text-muted-foreground">Manage API keys for external integrations</p>
            </div>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create API Key
            </Button>
          </div>

          <Tabs defaultValue="keys" className="space-y-6">
            <TabsList>
              <TabsTrigger value="keys" className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                API Keys
              </TabsTrigger>
              <TabsTrigger value="docs" className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                API Documentation
              </TabsTrigger>
            </TabsList>

            {/* API Keys Tab */}
            <TabsContent value="keys" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Active API Keys</CardTitle>
                  <CardDescription>
                    Keys are used to authenticate API requests from external applications
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Key Prefix</TableHead>
                        <TableHead>Scopes</TableHead>
                        <TableHead>Rate Limit</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last Used</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8">
                            Loading API keys...
                          </TableCell>
                        </TableRow>
                      ) : apiKeys.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                            No API keys yet. Create one to get started.
                          </TableCell>
                        </TableRow>
                      ) : (
                        apiKeys.map((key) => (
                          <TableRow key={key.id} className={!key.isActive ? 'opacity-50' : ''}>
                            <TableCell>
                              <div>
                                <p className="font-medium">{key.name}</p>
                                {key.description && (
                                  <p className="text-xs text-muted-foreground">{key.description}</p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <code className="bg-muted px-2 py-1 rounded text-sm">{key.keyPrefix}...</code>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1 flex-wrap">
                                {key.scopes.map((scope) => (
                                  <span key={scope} className={`px-2 py-0.5 rounded text-xs ${getScopeColor(scope)}`}>
                                    {scope}
                                  </span>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>{key.rateLimit}/15min</TableCell>
                            <TableCell>
                              {key.isActive ? (
                                <Badge variant="default" className="bg-green-500">Active</Badge>
                              ) : (
                                <Badge variant="secondary">Disabled</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {key.lastUsedAt ? (
                                new Date(key.lastUsedAt).toLocaleDateString()
                              ) : (
                                <span className="text-muted-foreground">Never</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleToggleActive(key)}
                                  title={key.isActive ? 'Disable' : 'Enable'}
                                >
                                  {key.isActive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteKey(key.id)}
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

            {/* API Documentation Tab */}
            <TabsContent value="docs" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Code className="w-5 h-5" />
                    API Reference
                  </CardTitle>
                  <CardDescription>
                    Documentation for integrating with the StewardPOS API
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {apiDocs && (
                    <>
                      {/* Authentication */}
                      <div className="space-y-3">
                        <h3 className="font-semibold flex items-center gap-2">
                          <Shield className="w-4 h-4" />
                          Authentication
                        </h3>
                        <div className="bg-muted p-4 rounded-lg">
                          <p className="text-sm mb-2">All API requests require authentication via Bearer token:</p>
                          <code className="block bg-card p-3 rounded text-sm">
                            Authorization: Bearer spk_xxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
                          </code>
                        </div>
                      </div>

                      {/* Scopes */}
                      <div className="space-y-3">
                        <h3 className="font-semibold">Scopes</h3>
                        <div className="grid grid-cols-2 gap-3">
                          {Object.entries(apiDocs.scopes).map(([scope, description]) => (
                            <div key={scope} className="flex items-start gap-2 p-3 bg-muted rounded-lg">
                              <span className={`px-2 py-0.5 rounded text-xs ${getScopeColor(scope)}`}>{scope}</span>
                              <span className="text-sm">{description}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Endpoints */}
                      <div className="space-y-3">
                        <h3 className="font-semibold">Endpoints</h3>
                        <Accordion type="multiple" className="w-full">
                          {apiDocs.endpoints.map((group) => (
                            <AccordionItem key={group.group} value={group.group}>
                              <AccordionTrigger>{group.group}</AccordionTrigger>
                              <AccordionContent>
                                <div className="space-y-2">
                                  {group.routes.map((route: any, idx: number) => (
                                    <div key={idx} className="flex items-center gap-3 p-2 bg-muted/50 rounded">
                                      <Badge variant={
                                        route.method === 'GET' ? 'default' :
                                        route.method === 'POST' ? 'secondary' :
                                        route.method === 'PUT' ? 'outline' : 'destructive'
                                      } className="font-mono text-xs w-16 justify-center">
                                        {route.method}
                                      </Badge>
                                      <code className="text-sm flex-1">{route.path}</code>
                                      <span className={`px-2 py-0.5 rounded text-xs ${getScopeColor(route.scope)}`}>
                                        {route.scope}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      </div>

                      {/* Rate Limiting */}
                      <div className="space-y-3">
                        <h3 className="font-semibold flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          Rate Limiting
                        </h3>
                        <div className="bg-muted p-4 rounded-lg">
                          <p className="text-sm">
                            Rate limits are per API key. The default is 1000 requests per 15 minutes.
                            Check the <code className="bg-card px-1 rounded">X-RateLimit-Remaining</code> header for remaining requests.
                          </p>
                        </div>
                      </div>

                      {/* Error Codes */}
                      <div className="space-y-3">
                        <h3 className="font-semibold flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Error Codes
                        </h3>
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(apiDocs.errors).map(([code, description]) => (
                            <div key={code} className="flex items-center gap-2 p-2 bg-muted rounded">
                              <Badge variant="outline">{code}</Badge>
                              <span className="text-sm">{description}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Create API Key Dialog */}
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create API Key</DialogTitle>
                <DialogDescription>
                  Generate a new API key for external integrations
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="My Integration"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="What this key is used for..."
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Scopes</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {SCOPES.map((scope) => (
                      <div key={scope.id} className="flex items-start gap-2">
                        <Checkbox
                          id={scope.id}
                          checked={formScopes.includes(scope.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setFormScopes([...formScopes, scope.id]);
                            } else {
                              setFormScopes(formScopes.filter(s => s !== scope.id));
                            }
                          }}
                        />
                        <div>
                          <Label htmlFor={scope.id} className="cursor-pointer">{scope.label}</Label>
                          <p className="text-xs text-muted-foreground">{scope.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rateLimit">Rate Limit (requests per 15 min)</Label>
                  <Input
                    id="rateLimit"
                    type="number"
                    value={formRateLimit}
                    onChange={(e) => setFormRateLimit(parseInt(e.target.value) || 1000)}
                    min={1}
                    max={100000}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setCreateDialogOpen(false); resetForm(); }}>
                  Cancel
                </Button>
                <Button onClick={handleCreateKey}>
                  Create Key
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* New Key Display Dialog */}
          <Dialog open={newKeyDialogOpen} onOpenChange={setNewKeyDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-green-600">
                  <Key className="w-5 h-5" />
                  API Key Created
                </DialogTitle>
                <DialogDescription>
                  Copy your API key now. You won't be able to see it again!
                </DialogDescription>
              </DialogHeader>
              {newKey && (
                <div className="space-y-4">
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg text-sm">
                    <strong>Important:</strong> This is the only time you will see this key. 
                    Store it securely - you cannot retrieve it later.
                  </div>

                  <div className="space-y-2">
                    <Label>API Key</Label>
                    <div className="flex gap-2">
                      <Input
                        type={showKey ? 'text' : 'password'}
                        value={newKey.key || ''}
                        readOnly
                        className="font-mono text-sm"
                      />
                      <Button variant="outline" size="icon" onClick={() => setShowKey(!showKey)}>
                        {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                      <Button variant="outline" size="icon" onClick={() => copyToClipboard(newKey.key || '')}>
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Name:</span>
                      <p className="font-medium">{newKey.name}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Scopes:</span>
                      <div className="flex gap-1 mt-1">
                        {newKey.scopes.map((scope) => (
                          <span key={scope} className={`px-2 py-0.5 rounded text-xs ${getScopeColor(scope)}`}>
                            {scope}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => { setNewKeyDialogOpen(false); setNewKey(null); setShowKey(false); }}>
                  Done
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}

