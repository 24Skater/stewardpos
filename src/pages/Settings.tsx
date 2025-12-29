import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiClient } from "@/lib/api-client";
import { ArrowLeft, Save, Store, Palette, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

interface Settings {
  taxRateDefault: number;
  storeName: string;
  storeEmail: string;
  storePhone: string;
  timezone: string;
  logoUrl?: string;
  iconUrl?: string;
  brandColor?: string;
  config?: Record<string, any>;
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

export default function Settings() {
  const [settings, setSettings] = useState<Settings>({
    taxRateDefault: 0.08,
    storeName: 'Persona Store',
    storeEmail: '',
    storePhone: '',
    timezone: 'UTC',
    brandColor: '#3b82f6',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
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
          taxRateDefault: response.data.taxRateDefault || 0.08,
          storeName: response.data.storeName || 'Persona Store',
          storeEmail: response.data.storeEmail || '',
          storePhone: response.data.storePhone || '',
          timezone: response.data.timezone || 'UTC',
          logoUrl: response.data.logoUrl,
          iconUrl: response.data.iconUrl,
          brandColor: response.data.brandColor || '#3b82f6',
          config: response.data.config || {},
        });
      }
    } catch (error: any) {
      // If API fails, keep default settings (for non-logged in users)
      console.warn('Could not load settings from API:', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const response = await apiClient.put<{ success: boolean; data: Settings }>('/api/admin/settings', settings);
      if (response.success) {
        toast({ title: "Settings saved successfully" });
      }
    } catch (error: any) {
      toast({ 
        title: "Error saving settings", 
        description: error.message || 'Failed to save settings',
        variant: "destructive" 
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-3 shadow-sm sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => navigate('/')}
              className="hover:bg-secondary"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">Settings</h1>
              <p className="text-xs text-muted-foreground">Store configuration</p>
            </div>
          </div>
          <Button 
            onClick={handleSave} 
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </header>

      <div className="p-6 max-w-2xl mx-auto space-y-6">
        {/* Store Information */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Store className="w-5 h-5" />
              Store Information
            </CardTitle>
            <CardDescription>Basic store details displayed to customers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="storeName" className="text-foreground">Store Name</Label>
              <Input
                id="storeName"
                value={settings.storeName}
                onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
                className="bg-background border-border"
                placeholder="Your Store Name"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="storeEmail" className="text-foreground">Store Email</Label>
                <Input
                  id="storeEmail"
                  type="email"
                  value={settings.storeEmail}
                  onChange={(e) => setSettings({ ...settings, storeEmail: e.target.value })}
                  className="bg-background border-border"
                  placeholder="store@example.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="storePhone" className="text-foreground">Store Phone</Label>
                <Input
                  id="storePhone"
                  type="tel"
                  value={settings.storePhone}
                  onChange={(e) => setSettings({ ...settings, storePhone: e.target.value })}
                  className="bg-background border-border"
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tax & Timezone */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Regional Settings
            </CardTitle>
            <CardDescription>Tax rates and timezone configuration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="taxRate" className="text-foreground">Default Tax Rate (%)</Label>
                <Input
                  id="taxRate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={(settings.taxRateDefault * 100).toFixed(2)}
                  onChange={(e) => setSettings({ ...settings, taxRateDefault: parseFloat(e.target.value) / 100 || 0 })}
                  className="bg-background border-border"
                />
                <p className="text-xs text-muted-foreground">
                  Current: {(settings.taxRateDefault * 100).toFixed(2)}%
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="timezone" className="text-foreground">Timezone</Label>
                <Select
                  value={settings.timezone}
                  onValueChange={(value) => setSettings({ ...settings, timezone: value })}
                >
                  <SelectTrigger className="bg-background border-border">
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

        {/* Branding */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Palette className="w-5 h-5" />
              Branding
            </CardTitle>
            <CardDescription>Customize your store appearance</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="logoUrl" className="text-foreground">Logo URL</Label>
                <Input
                  id="logoUrl"
                  type="url"
                  value={settings.logoUrl || ''}
                  onChange={(e) => setSettings({ ...settings, logoUrl: e.target.value || undefined })}
                  className="bg-background border-border"
                  placeholder="https://example.com/logo.png"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="iconUrl" className="text-foreground">Favicon URL</Label>
                <Input
                  id="iconUrl"
                  type="url"
                  value={settings.iconUrl || ''}
                  onChange={(e) => setSettings({ ...settings, iconUrl: e.target.value || undefined })}
                  className="bg-background border-border"
                  placeholder="https://example.com/favicon.ico"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="brandColor" className="text-foreground">Brand Color</Label>
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
                  className="bg-background border-border flex-1"
                  placeholder="#3b82f6"
                  pattern="^#[0-9A-Fa-f]{6}$"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
