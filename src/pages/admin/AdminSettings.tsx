import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { apiClient } from '@/lib/api-client';
import { Save, Store, Shield, Palette, Database, RefreshCw, Upload, Link, X, Image } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';

interface Settings {
  taxRateDefault: number;
  storeName: string;
  storeEmail: string;
  storePhone: string;
  timezone: string;
  logoUrl?: string;
  iconUrl?: string;
  brandColor?: string;
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
  const [settings, setSettings] = useState<Settings>({
    taxRateDefault: 0.08,
    storeName: 'Persona Store',
    storeEmail: '',
    storePhone: '',
    timezone: 'UTC',
    brandColor: '#3b82f6',
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
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [logoInputMode, setLogoInputMode] = useState<'url' | 'upload'>('url');
  const [iconInputMode, setIconInputMode] = useState<'url' | 'upload'>('url');
  
  const logoFileRef = useRef<HTMLInputElement>(null);
  const iconFileRef = useRef<HTMLInputElement>(null);
  
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

  const handleFileUpload = async (file: File, type: 'logo' | 'icon') => {
    const setUploading = type === 'logo' ? setUploadingLogo : setUploadingIcon;
    
    try {
      setUploading(true);
      
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch(`/api/upload/${type}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: formData,
      });
      
      const result = await response.json();
      
      if (result.success) {
        if (type === 'logo') {
          setSettings({ ...settings, logoUrl: result.data.url });
        } else {
          setSettings({ ...settings, iconUrl: result.data.url });
        }
        toast({ title: `${type === 'logo' ? 'Logo' : 'Icon'} uploaded successfully` });
      } else {
        throw new Error(result.message || 'Upload failed');
      }
    } catch (error: any) {
      toast({
        title: 'Upload failed',
        description: error.message || 'Failed to upload file',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file, 'logo');
    }
  };

  const handleIconFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file, 'icon');
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
              <TabsTrigger value="branding">Branding</TabsTrigger>
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

            {/* Branding Settings */}
            <TabsContent value="branding" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="w-5 h-5" />
                    Branding
                  </CardTitle>
                  <CardDescription>Customize your store appearance</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Logo Upload */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Store Logo</Label>
                      <div className="flex gap-2">
                        <Button 
                          variant={logoInputMode === 'upload' ? 'default' : 'outline'} 
                          size="sm"
                          onClick={() => setLogoInputMode('upload')}
                        >
                          <Upload className="w-3 h-3 mr-1" />
                          Upload
                        </Button>
                        <Button 
                          variant={logoInputMode === 'url' ? 'default' : 'outline'} 
                          size="sm"
                          onClick={() => setLogoInputMode('url')}
                        >
                          <Link className="w-3 h-3 mr-1" />
                          URL
                        </Button>
                      </div>
                    </div>
                    
                    {logoInputMode === 'upload' ? (
                      <div className="flex items-center gap-4">
                        <input
                          ref={logoFileRef}
                          type="file"
                          accept="image/*"
                          onChange={handleLogoFileChange}
                          className="hidden"
                        />
                        <Button 
                          variant="outline" 
                          onClick={() => logoFileRef.current?.click()}
                          disabled={uploadingLogo}
                        >
                          {uploadingLogo ? (
                            <>
                              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4 mr-2" />
                              Choose File
                            </>
                          )}
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          Max 5MB. PNG, JPG, GIF, WebP, SVG
                        </span>
                      </div>
                    ) : (
                      <Input
                        type="url"
                        value={settings.logoUrl || ''}
                        onChange={(e) => setSettings({ ...settings, logoUrl: e.target.value || undefined })}
                        placeholder="https://example.com/logo.png"
                      />
                    )}
                    
                    {settings.logoUrl && (
                      <div className="flex items-center gap-4 p-4 bg-secondary/30 rounded-lg">
                        <div className="w-24 h-24 bg-white rounded-lg border flex items-center justify-center overflow-hidden">
                          <img 
                            src={settings.logoUrl} 
                            alt="Logo preview" 
                            className="max-w-full max-h-full object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = '';
                              (e.target as HTMLImageElement).alt = 'Failed to load';
                            }}
                          />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">Current Logo</p>
                          <p className="text-xs text-muted-foreground truncate max-w-xs">{settings.logoUrl}</p>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => setSettings({ ...settings, logoUrl: undefined })}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Icon/Favicon Upload */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Favicon / Icon</Label>
                      <div className="flex gap-2">
                        <Button 
                          variant={iconInputMode === 'upload' ? 'default' : 'outline'} 
                          size="sm"
                          onClick={() => setIconInputMode('upload')}
                        >
                          <Upload className="w-3 h-3 mr-1" />
                          Upload
                        </Button>
                        <Button 
                          variant={iconInputMode === 'url' ? 'default' : 'outline'} 
                          size="sm"
                          onClick={() => setIconInputMode('url')}
                        >
                          <Link className="w-3 h-3 mr-1" />
                          URL
                        </Button>
                      </div>
                    </div>
                    
                    {iconInputMode === 'upload' ? (
                      <div className="flex items-center gap-4">
                        <input
                          ref={iconFileRef}
                          type="file"
                          accept="image/*,.ico"
                          onChange={handleIconFileChange}
                          className="hidden"
                        />
                        <Button 
                          variant="outline" 
                          onClick={() => iconFileRef.current?.click()}
                          disabled={uploadingIcon}
                        >
                          {uploadingIcon ? (
                            <>
                              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4 mr-2" />
                              Choose File
                            </>
                          )}
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          Recommended: 32x32 or 64x64 pixels
                        </span>
                      </div>
                    ) : (
                      <Input
                        type="url"
                        value={settings.iconUrl || ''}
                        onChange={(e) => setSettings({ ...settings, iconUrl: e.target.value || undefined })}
                        placeholder="https://example.com/favicon.ico"
                      />
                    )}
                    
                    {settings.iconUrl && (
                      <div className="flex items-center gap-4 p-4 bg-secondary/30 rounded-lg">
                        <div className="w-16 h-16 bg-white rounded-lg border flex items-center justify-center overflow-hidden">
                          <img 
                            src={settings.iconUrl} 
                            alt="Icon preview" 
                            className="max-w-full max-h-full object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = '';
                              (e.target as HTMLImageElement).alt = 'Failed to load';
                            }}
                          />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">Current Icon</p>
                          <p className="text-xs text-muted-foreground truncate max-w-xs">{settings.iconUrl}</p>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => setSettings({ ...settings, iconUrl: undefined })}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Brand Color */}
                  <div className="space-y-2">
                    <Label htmlFor="brandColor">Brand Color</Label>
                    <div className="flex items-center gap-3">
                      <Input
                        id="brandColor"
                        type="color"
                        value={settings.brandColor || '#3b82f6'}
                        onChange={(e) => setSettings({ ...settings, brandColor: e.target.value })}
                        className="w-16 h-10 p-1 cursor-pointer"
                      />
                      <Input
                        type="text"
                        value={settings.brandColor || '#3b82f6'}
                        onChange={(e) => setSettings({ ...settings, brandColor: e.target.value })}
                        className="flex-1"
                        placeholder="#3b82f6"
                      />
                      <div 
                        className="w-10 h-10 rounded-lg border"
                        style={{ backgroundColor: settings.brandColor || '#3b82f6' }}
                      />
                    </div>
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
