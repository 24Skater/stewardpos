import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { apiClient } from '@/lib/api-client';
import { Save, Store, Shield, Database, RefreshCw, Palette, ArrowRight } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';

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
  };
}

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
  const navigate = useNavigate();
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
    },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  
  const { toast } = useToast();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<{ success: boolean; data: Settings }>('/api/admin/settings');
      if (response.success && response.data) {
        setSettings({
          ...settings,
          ...response.data,
          config: {
            authMethods: {
              local: true,
              google: false,
              oidc: false,
              ...response.data.config?.authMethods,
            },
            demoMode: response.data.config?.demoMode || false,
          },
        });
      }
    } catch (error: any) {
      console.warn('Could not load settings:', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const response = await apiClient.put<{ success: boolean; data: Settings }>('/api/admin/settings', settings);
      if (response.success) {
        toast({ title: 'Settings saved successfully' });
      }
    } catch (error: any) {
      toast({
        title: 'Error saving settings',
        description: error.message || 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDatabase = async () => {
    if (!confirm('Are you sure you want to reset the database? This will delete all orders and re-seed products.')) {
      return;
    }

    try {
      setResetting(true);
      const response = await apiClient.post<{ success: boolean; message: string }>('/api/admin/reset-database', {});
      if (response.success) {
        toast({ title: 'Database reset successfully', description: response.message });
      }
    } catch (error: any) {
      toast({
        title: 'Error resetting database',
        description: error.message || 'Failed to reset database',
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

              {/* Branding Link Card */}
              <Card className="border-dashed">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-primary/10 rounded-lg">
                        <Palette className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold">Branding & Appearance</h3>
                        <p className="text-sm text-muted-foreground">
                          Customize logo, colors, store identity, and receipt appearance
                        </p>
                      </div>
                    </div>
                    <Button onClick={() => navigate('/admin/branding')}>
                      Go to Branding
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
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
