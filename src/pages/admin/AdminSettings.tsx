import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { apiClient } from '@/lib/api-client';
import { Save, Store, Shield, Database, RefreshCw, CreditCard, Banknote, Smartphone } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/errors';

interface PaymentMethodsConfig {
  cash?: { enabled: boolean };
  zelle?: { enabled: boolean; destination?: string };
  card?: { enabled: boolean; provider?: string };
}

interface TerminalCredentials {
  stripeSecretKey?: string;
  stripeTerminalLocationId?: string;
  stripeReaderId?: string;
  squareAccessToken?: string;
  squareLocationId?: string;
  squareDeviceId?: string;
  cloverApiToken?: string;
  cloverMerchantId?: string;
  cloverDeviceId?: string;
  verifoneApiKey?: string;
  verifoneTerminalId?: string;
  verifoneMerchantId?: string;
  dejavooApiKey?: string;
  dejavooTerminalId?: string;
  dejavooMerchantId?: string;
}

interface Settings {
  taxRateDefault: number;
  storeName: string;
  storeEmail: string;
  storePhone: string;
  timezone: string;
  config?: {
    authMethods?: {
      local?: boolean;
      google?: boolean;
      oidc?: boolean;
    };
    demoMode?: boolean;
    paymentMethods?: PaymentMethodsConfig;
    terminalCredentials?: TerminalCredentials;
  };
}

const CARD_PROVIDERS = [
  { value: 'square', label: 'Square' },
  { value: 'stripe', label: 'Stripe Terminal' },
  { value: 'clover', label: 'Clover' },
  { value: 'paypal', label: 'PayPal Here' },
  { value: 'dejavoo', label: 'Dejavoo' },
  { value: 'verifone', label: 'Verifone' },
  { value: 'generic', label: 'Generic / Other' },
];

const timezones = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Australia/Sydney',
];

export default function AdminSettings() {
  const [settings, setSettings] = useState<Settings>({
    taxRateDefault: 0.08,
    storeName: 'Persona Store',
    storeEmail: '',
    storePhone: '',
    timezone: 'UTC',
    config: {
      authMethods: {
        local: true,
        google: false,
        oidc: false,
      },
      demoMode: false,
      paymentMethods: {
        cash: { enabled: true },
        zelle: { enabled: false, destination: '' },
        card: { enabled: false, provider: 'square' },
      },
    },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [terminalCreds, setTerminalCreds] = useState<TerminalCredentials>({});
  const [testingConnection, setTestingConnection] = useState(false);
  const [discoveringReaders, setDiscoveringReaders] = useState(false);
  const [readers, setReaders] = useState<Array<{ id: string; label: string; status: string }>>([]);

  const { toast } = useToast();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<Settings>('/api/admin/settings');
      if (response && response) {
        setSettings({
          ...settings,
          ...response,
          config: {
            authMethods: {
              local: true,
              google: false,
              oidc: false,
              ...response.config?.authMethods,
            },
            demoMode: response.config?.demoMode || false,
            paymentMethods: {
              cash: { enabled: true },
              zelle: { enabled: false, destination: '' },
              card: { enabled: false, provider: 'square' },
              ...response.config?.paymentMethods,
            },
          },
        });
        if (response.config?.terminalCredentials) {
          setTerminalCreds(response.config.terminalCredentials);
        }
      }
    } catch (error: unknown) {
      console.warn('Could not load settings:', getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const payload = {
        ...settings,
        config: {
          ...settings.config,
          terminalCredentials: terminalCreds,
        },
      };
      const response = await apiClient.put<Settings>('/api/admin/settings', payload);
      toast({ title: 'Settings saved successfully' });
    } catch (error: unknown) {
      toast({
        title: 'Error saving settings',
        description: error instanceof Error ? getErrorMessage(error) : 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      await apiClient.post<void>('/api/terminal/test', {});
      toast({
        title: 'Connection successful',
        description: 'The terminal responded to the test request.',
      });
    } catch (error: unknown) {
      toast({
        title: 'Connection test failed',
        description: error instanceof Error ? getErrorMessage(error) : 'Error',
        variant: 'destructive',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleDiscoverReaders = async () => {
    setDiscoveringReaders(true);
    try {
      const data = await apiClient.get<Array<{ id: string; label: string; status: string }>>('/api/terminal/readers');
      const found = (data as unknown as { data?: Array<{ id: string; label: string; status: string }> }).data || [];
      setReaders(found);
      toast({ title: `Found ${found.length} reader(s)` });
    } catch (error: unknown) {
      toast({
        title: 'Reader discovery failed',
        description: error instanceof Error ? getErrorMessage(error) : 'Error',
        variant: 'destructive',
      });
    } finally {
      setDiscoveringReaders(false);
    }
  };

  const handleResetDatabase = async () => {
    if (!confirm('Are you sure you want to reset the database? This will delete all orders and re-seed products.')) {
      return;
    }

    try {
      setResetting(true);
      const response = await apiClient.post<void>('/api/admin/reset-database', {});
      toast({ title: 'Database reset successfully' });
    } catch (error: unknown) {
      toast({
        title: 'Error resetting database',
        description: getErrorMessage(error, 'Failed to reset database'),
        variant: 'destructive',
      });
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <AdminLayout>
          <div className="p-8 flex items-center justify-center">
            <p className="text-muted-foreground">Loading settings...</p>
          </div>
        </AdminLayout>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Settings</h1>
              <p className="text-muted-foreground">Configure store and application settings</p>
            </div>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>

          <Tabs defaultValue="general" className="space-y-4">
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="auth">Authentication</TabsTrigger>
              <TabsTrigger value="database">Database</TabsTrigger>
            </TabsList>

            {/* General Settings */}
            <TabsContent value="general" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Store className="w-5 h-5" />
                    Store Information
                  </CardTitle>
                  <CardDescription>Basic store details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="storeName">Store Name</Label>
                    <Input
                      id="storeName"
                      value={settings.storeName}
                      onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
                      placeholder="Your Store Name"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="storeEmail">Store Email</Label>
                      <Input
                        id="storeEmail"
                        type="email"
                        value={settings.storeEmail}
                        onChange={(e) => setSettings({ ...settings, storeEmail: e.target.value })}
                        placeholder="store@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="storePhone">Store Phone</Label>
                      <Input
                        id="storePhone"
                        type="tel"
                        value={settings.storePhone}
                        onChange={(e) => setSettings({ ...settings, storePhone: e.target.value })}
                        placeholder="(555) 123-4567"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="taxRate">Default Tax Rate (%)</Label>
                      <Input
                        id="taxRate"
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={(settings.taxRateDefault * 100).toFixed(2)}
                        onChange={(e) => setSettings({ ...settings, taxRateDefault: parseFloat(e.target.value) / 100 || 0 })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="timezone">Timezone</Label>
                      <Select
                        value={settings.timezone}
                        onValueChange={(value) => setSettings({ ...settings, timezone: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select timezone" />
                        </SelectTrigger>
                        <SelectContent>
                          {timezones.map((tz) => (
                            <SelectItem key={tz} value={tz}>
                              {tz.replace(/_/g, ' ')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

            </TabsContent>

            {/* Payment Methods */}
            <TabsContent value="payments" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5" />
                    Payment Methods
                  </CardTitle>
                  <CardDescription>Enable the payment methods available at the register</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">

                  {/* Cash */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Banknote className="w-5 h-5 text-muted-foreground" />
                      <div>
                        <Label>Cash</Label>
                        <p className="text-sm text-muted-foreground">Accept physical cash payments</p>
                      </div>
                    </div>
                    <Switch
                      data-testid="cash-toggle"
                      checked={settings.config?.paymentMethods?.cash?.enabled}
                      onCheckedChange={(checked) =>
                        setSettings({
                          ...settings,
                          config: {
                            ...settings.config,
                            paymentMethods: {
                              ...settings.config?.paymentMethods,
                              cash: { enabled: checked },
                            },
                          },
                        })
                      }
                    />
                  </div>

                  {/* Zelle */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Smartphone className="w-5 h-5 text-muted-foreground" />
                        <div>
                          <Label>Zelle</Label>
                          <p className="text-sm text-muted-foreground">Accept Zelle digital payments</p>
                        </div>
                      </div>
                      <Switch
                        data-testid="zelle-toggle"
                        checked={settings.config?.paymentMethods?.zelle?.enabled}
                        onCheckedChange={(checked) =>
                          setSettings({
                            ...settings,
                            config: {
                              ...settings.config,
                              paymentMethods: {
                                ...settings.config?.paymentMethods,
                                zelle: {
                                  ...settings.config?.paymentMethods?.zelle,
                                  enabled: checked,
                                },
                              },
                            },
                          })
                        }
                      />
                    </div>
                    {settings.config?.paymentMethods?.zelle?.enabled && (
                      <div className="ml-8 space-y-2">
                        <Label htmlFor="zelleDestination">Zelle Phone / Email</Label>
                        <Input
                          id="zelleDestination"
                          data-testid="zelle-destination"
                          placeholder="(555) 123-4567 or payments@store.com"
                          value={settings.config?.paymentMethods?.zelle?.destination || ''}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              config: {
                                ...settings.config,
                                paymentMethods: {
                                  ...settings.config?.paymentMethods,
                                  zelle: {
                                    ...settings.config?.paymentMethods?.zelle,
                                    destination: e.target.value,
                                  },
                                },
                              },
                            })
                          }
                        />
                        <p className="text-xs text-muted-foreground">Shown to cashier at checkout so they can display it to the customer</p>
                      </div>
                    )}
                  </div>

                  {/* Credit / Debit Card */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CreditCard className="w-5 h-5 text-muted-foreground" />
                        <div>
                          <Label>Credit / Debit Card</Label>
                          <p className="text-sm text-muted-foreground">Accept card payments via a card reader</p>
                        </div>
                      </div>
                      <Switch
                        data-testid="card-toggle"
                        checked={settings.config?.paymentMethods?.card?.enabled}
                        onCheckedChange={(checked) =>
                          setSettings({
                            ...settings,
                            config: {
                              ...settings.config,
                              paymentMethods: {
                                ...settings.config?.paymentMethods,
                                card: {
                                  ...settings.config?.paymentMethods?.card,
                                  enabled: checked,
                                },
                              },
                            },
                          })
                        }
                      />
                    </div>
                    {settings.config?.paymentMethods?.card?.enabled && (
                      <div className="ml-8 space-y-2">
                        <Label htmlFor="cardProvider">Card Reader Provider</Label>
                        <Select
                          value={settings.config?.paymentMethods?.card?.provider || 'square'}
                          onValueChange={(value) =>
                            setSettings({
                              ...settings,
                              config: {
                                ...settings.config,
                                paymentMethods: {
                                  ...settings.config?.paymentMethods,
                                  card: {
                                    ...settings.config?.paymentMethods?.card,
                                    provider: value,
                                  },
                                },
                              },
                            })
                          }
                        >
                          <SelectTrigger data-testid="card-provider-select">
                            <SelectValue placeholder="Select provider" />
                          </SelectTrigger>
                          <SelectContent>
                            {CARD_PROVIDERS.map((p) => (
                              <SelectItem key={p.value} value={p.value}>
                                {p.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">Used for labeling orders only — process payment on the reader, then confirm here</p>

                        {/* Terminal Credentials */}
                        <div className="mt-4 space-y-4 border-t pt-4">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium">Terminal Credentials</Label>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleDiscoverReaders}
                                disabled={discoveringReaders}
                              >
                                {discoveringReaders ? 'Discovering...' : 'Discover Readers'}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleTestConnection}
                                disabled={testingConnection}
                              >
                                {testingConnection ? 'Testing...' : 'Test Connection'}
                              </Button>
                            </div>
                          </div>

                          {/* Stripe fields */}
                          {settings.config?.paymentMethods?.card?.provider === 'stripe' && (
                            <div className="space-y-3">
                              <div>
                                <Label>Secret Key</Label>
                                <Input
                                  type="password"
                                  placeholder="sk_live_••••••••"
                                  value={terminalCreds.stripeSecretKey || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, stripeSecretKey: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label>Terminal Location ID</Label>
                                <Input
                                  placeholder="tml_xxxxxxxxxxxx"
                                  value={terminalCreds.stripeTerminalLocationId || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, stripeTerminalLocationId: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label>Reader ID</Label>
                                <Input
                                  placeholder="tmr_xxxxxxxxxxxx"
                                  value={terminalCreds.stripeReaderId || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, stripeReaderId: e.target.value })}
                                />
                                {readers.length > 0 && (
                                  <select
                                    className="mt-1 w-full border rounded px-2 py-1 text-sm"
                                    value={terminalCreds.stripeReaderId || ''}
                                    onChange={(e) => setTerminalCreds({ ...terminalCreds, stripeReaderId: e.target.value })}
                                  >
                                    <option value="">Pick a discovered reader</option>
                                    {readers.map((r) => (
                                      <option key={r.id} value={r.id}>{r.label} ({r.status})</option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Square fields */}
                          {settings.config?.paymentMethods?.card?.provider === 'square' && (
                            <div className="space-y-3">
                              <div>
                                <Label>Access Token</Label>
                                <Input
                                  type="password"
                                  placeholder="EAAAxxxxxxxx"
                                  value={terminalCreds.squareAccessToken || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, squareAccessToken: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label>Location ID</Label>
                                <Input
                                  placeholder="Lxxxxxxxxx"
                                  value={terminalCreds.squareLocationId || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, squareLocationId: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label>Device ID</Label>
                                <Input
                                  placeholder="Dxxxxxxxxx"
                                  value={terminalCreds.squareDeviceId || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, squareDeviceId: e.target.value })}
                                />
                                {readers.length > 0 && (
                                  <select
                                    className="mt-1 w-full border rounded px-2 py-1 text-sm"
                                    value={terminalCreds.squareDeviceId || ''}
                                    onChange={(e) => setTerminalCreds({ ...terminalCreds, squareDeviceId: e.target.value })}
                                  >
                                    <option value="">Pick a discovered device</option>
                                    {readers.map((r) => (
                                      <option key={r.id} value={r.id}>{r.label} ({r.status})</option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Clover fields */}
                          {settings.config?.paymentMethods?.card?.provider === 'clover' && (
                            <div className="space-y-3">
                              <div>
                                <Label>API Token</Label>
                                <Input
                                  type="password"
                                  placeholder="••••••••••••"
                                  value={terminalCreds.cloverApiToken || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, cloverApiToken: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label>Merchant ID</Label>
                                <Input
                                  placeholder="xxxxxxxxx"
                                  value={terminalCreds.cloverMerchantId || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, cloverMerchantId: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label>Device ID</Label>
                                <Input
                                  placeholder="xxxxxxxxx"
                                  value={terminalCreds.cloverDeviceId || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, cloverDeviceId: e.target.value })}
                                />
                              </div>
                            </div>
                          )}

                          {/* Verifone fields */}
                          {settings.config?.paymentMethods?.card?.provider === 'verifone' && (
                            <div className="space-y-3">
                              <div>
                                <Label>API Key</Label>
                                <Input
                                  type="password"
                                  placeholder="••••••••••••"
                                  value={terminalCreds.verifoneApiKey || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, verifoneApiKey: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label>Merchant ID</Label>
                                <Input
                                  placeholder="xxxxxxxxx"
                                  value={terminalCreds.verifoneMerchantId || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, verifoneMerchantId: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label>Terminal ID / IP</Label>
                                <Input
                                  placeholder="192.168.1.x or terminal ID"
                                  value={terminalCreds.verifoneTerminalId || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, verifoneTerminalId: e.target.value })}
                                />
                              </div>
                            </div>
                          )}

                          {/* Dejavoo fields */}
                          {settings.config?.paymentMethods?.card?.provider === 'dejavoo' && (
                            <div className="space-y-3">
                              <div>
                                <Label>API Key</Label>
                                <Input
                                  type="password"
                                  placeholder="••••••••••••"
                                  value={terminalCreds.dejavooApiKey || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, dejavooApiKey: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label>Merchant ID</Label>
                                <Input
                                  placeholder="xxxxxxxxx"
                                  value={terminalCreds.dejavooMerchantId || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, dejavooMerchantId: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label>Terminal ID</Label>
                                <Input
                                  placeholder="xxxxxxxxx"
                                  value={terminalCreds.dejavooTerminalId || ''}
                                  onChange={(e) => setTerminalCreds({ ...terminalCreds, dejavooTerminalId: e.target.value })}
                                />
                              </div>
                            </div>
                          )}

                          {/* Generic/Manual — no fields */}
                          {(settings.config?.paymentMethods?.card?.provider === 'generic' ||
                            !settings.config?.paymentMethods?.card?.provider) && (
                            <p className="text-sm text-muted-foreground">
                              Generic / Manual mode — auto-approves for testing. No credentials required.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                </CardContent>
              </Card>
            </TabsContent>

            {/* Authentication Settings */}
            <TabsContent value="auth" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Authentication Providers
                  </CardTitle>
                  <CardDescription>Configure login methods</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Local Authentication</Label>
                      <p className="text-sm text-muted-foreground">Username and password login</p>
                    </div>
                    <Switch
                      checked={settings.config?.authMethods?.local}
                      onCheckedChange={(checked) =>
                        setSettings({
                          ...settings,
                          config: {
                            ...settings.config,
                            authMethods: { ...settings.config?.authMethods, local: checked },
                          },
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Google OAuth</Label>
                      <p className="text-sm text-muted-foreground">Sign in with Google (requires configuration)</p>
                    </div>
                    <Switch
                      checked={settings.config?.authMethods?.google}
                      onCheckedChange={(checked) =>
                        setSettings({
                          ...settings,
                          config: {
                            ...settings.config,
                            authMethods: { ...settings.config?.authMethods, google: checked },
                          },
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>OIDC / SSO</Label>
                      <p className="text-sm text-muted-foreground">OpenID Connect (Azure AD, Okta, etc.)</p>
                    </div>
                    <Switch
                      checked={settings.config?.authMethods?.oidc}
                      onCheckedChange={(checked) =>
                        setSettings({
                          ...settings,
                          config: {
                            ...settings.config,
                            authMethods: { ...settings.config?.authMethods, oidc: checked },
                          },
                        })
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Database Settings */}
            <TabsContent value="database" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="w-5 h-5" />
                    Database Management
                  </CardTitle>
                  <CardDescription>Database maintenance options</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Demo Mode</Label>
                      <p className="text-sm text-muted-foreground">Enable demo features and sample data</p>
                    </div>
                    <Switch
                      checked={settings.config?.demoMode}
                      onCheckedChange={(checked) =>
                        setSettings({
                          ...settings,
                          config: { ...settings.config, demoMode: checked },
                        })
                      }
                    />
                  </div>

                  <div className="border-t pt-4 mt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-destructive">Reset Database</Label>
                        <p className="text-sm text-muted-foreground">
                          Clear all orders and re-seed product data. This action cannot be undone.
                        </p>
                      </div>
                      <Button
                        variant="destructive"
                        onClick={handleResetDatabase}
                        disabled={resetting}
                      >
                        <RefreshCw className={`w-4 h-4 mr-2 ${resetting ? 'animate-spin' : ''}`} />
                        {resetting ? 'Resetting...' : 'Reset Database'}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
