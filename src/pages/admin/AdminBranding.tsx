import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api-client';
import { 
  Palette, Store, MapPin, Receipt, Image, FileText, Save, Eye, 
  Building2, Phone, Mail, Globe, Paintbrush
} from 'lucide-react';

interface BrandingSettings {
  // Store Identity
  storeName: string;
  storePhone: string;
  storeEmail: string;
  storeAddress: string;
  storeCity: string;
  storeState: string;
  storeZip: string;
  storeNumber: string;
  // Visual Branding
  logoUrl: string;
  iconUrl: string;
  brandColor: string;
  // Receipt Branding
  receiptLogoUrl: string;
  receiptHeaderText: string;
  receiptFooterText: string;
  receiptShowLogo: boolean;
  receiptShowBarcode: boolean;
}

export default function AdminBranding() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [previewMode, setPreviewMode] = useState(false);

  const [form, setForm] = useState<BrandingSettings>({
    storeName: '',
    storePhone: '',
    storeEmail: '',
    storeAddress: '',
    storeCity: '',
    storeState: '',
    storeZip: '',
    storeNumber: '',
    logoUrl: '',
    iconUrl: '',
    brandColor: '#3b82f6',
    receiptLogoUrl: '',
    receiptHeaderText: '',
    receiptFooterText: '',
    receiptShowLogo: true,
    receiptShowBarcode: true,
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: any }>('/api/admin/settings');
      return res.data;
    },
  });

  useEffect(() => {
    if (settings) {
      setForm({
        storeName: settings.storeName || '',
        storePhone: settings.storePhone || '',
        storeEmail: settings.storeEmail || '',
        storeAddress: settings.storeAddress || '',
        storeCity: settings.storeCity || '',
        storeState: settings.storeState || '',
        storeZip: settings.storeZip || '',
        storeNumber: settings.storeNumber || '',
        logoUrl: settings.logoUrl || '',
        iconUrl: settings.iconUrl || '',
        brandColor: settings.brandColor || '#3b82f6',
        receiptLogoUrl: settings.receiptLogoUrl || '',
        receiptHeaderText: settings.receiptHeaderText || '',
        receiptFooterText: settings.receiptFooterText || '',
        receiptShowLogo: settings.receiptShowLogo !== false,
        receiptShowBarcode: settings.receiptShowBarcode !== false,
      });
    }
  }, [settings]);

  const updateSettings = useMutation({
    mutationFn: (data: Partial<BrandingSettings>) => 
      apiClient.put('/api/admin/settings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast({ title: 'Branding settings saved successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to save settings', variant: 'destructive' });
    },
  });

  const handleSave = () => {
    updateSettings.mutate(form);
  };

  if (isLoading) {
    return (
      <ProtectedRoute>
        <AdminLayout>
          <div className="p-6 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </AdminLayout>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Palette className="w-8 h-8" />
                Branding
              </h1>
              <p className="text-muted-foreground">Customize your store identity, visual branding, and receipt appearance</p>
            </div>
            <Button onClick={handleSave} disabled={updateSettings.isPending}>
              <Save className="w-4 h-4 mr-2" />
              Save All Changes
            </Button>
          </div>

          <Tabs defaultValue="identity" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3 lg:w-[500px]">
              <TabsTrigger value="identity" className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Store Identity
              </TabsTrigger>
              <TabsTrigger value="visual" className="flex items-center gap-2">
                <Paintbrush className="w-4 h-4" />
                Visual
              </TabsTrigger>
              <TabsTrigger value="receipts" className="flex items-center gap-2">
                <Receipt className="w-4 h-4" />
                Receipts
              </TabsTrigger>
            </TabsList>

            {/* Store Identity Tab */}
            <TabsContent value="identity" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Basic Info */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Store className="w-5 h-5" />
                      Store Information
                    </CardTitle>
                    <CardDescription>Basic details about your store</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Store Name</Label>
                        <Input
                          value={form.storeName}
                          onChange={(e) => setForm({ ...form, storeName: e.target.value })}
                          placeholder="My Store"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Store Number/ID</Label>
                        <Input
                          value={form.storeNumber}
                          onChange={(e) => setForm({ ...form, storeNumber: e.target.value })}
                          placeholder="#001"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Contact Info */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Phone className="w-5 h-5" />
                      Contact Information
                    </CardTitle>
                    <CardDescription>How customers can reach you</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Phone className="w-4 h-4" />
                        Phone Number
                      </Label>
                      <Input
                        value={form.storePhone}
                        onChange={(e) => setForm({ ...form, storePhone: e.target.value })}
                        placeholder="(555) 123-4567"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Mail className="w-4 h-4" />
                        Email Address
                      </Label>
                      <Input
                        type="email"
                        value={form.storeEmail}
                        onChange={(e) => setForm({ ...form, storeEmail: e.target.value })}
                        placeholder="store@example.com"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Location */}
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MapPin className="w-5 h-5" />
                      Store Location
                    </CardTitle>
                    <CardDescription>Physical address shown on receipts and documents</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Street Address</Label>
                      <Input
                        value={form.storeAddress}
                        onChange={(e) => setForm({ ...form, storeAddress: e.target.value })}
                        placeholder="123 Main Street"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>City</Label>
                        <Input
                          value={form.storeCity}
                          onChange={(e) => setForm({ ...form, storeCity: e.target.value })}
                          placeholder="New York"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>State/Province</Label>
                        <Input
                          value={form.storeState}
                          onChange={(e) => setForm({ ...form, storeState: e.target.value })}
                          placeholder="NY"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>ZIP/Postal Code</Label>
                        <Input
                          value={form.storeZip}
                          onChange={(e) => setForm({ ...form, storeZip: e.target.value })}
                          placeholder="10001"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Visual Branding Tab */}
            <TabsContent value="visual" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Logo */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Image className="w-5 h-5" />
                      Logo
                    </CardTitle>
                    <CardDescription>Main logo used across the application</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Logo URL</Label>
                      <Input
                        value={form.logoUrl}
                        onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                        placeholder="https://example.com/logo.png"
                      />
                      <p className="text-xs text-muted-foreground">
                        Recommended: 200x80 pixels, PNG or SVG format
                      </p>
                    </div>
                    {form.logoUrl && (
                      <div className="p-4 bg-muted rounded-lg">
                        <p className="text-xs text-muted-foreground mb-2">Preview:</p>
                        <img 
                          src={form.logoUrl} 
                          alt="Logo Preview" 
                          className="max-h-16 object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Favicon/Icon */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="w-5 h-5" />
                      Favicon / App Icon
                    </CardTitle>
                    <CardDescription>Small icon for browser tabs and bookmarks</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Icon URL</Label>
                      <Input
                        value={form.iconUrl}
                        onChange={(e) => setForm({ ...form, iconUrl: e.target.value })}
                        placeholder="https://example.com/favicon.ico"
                      />
                      <p className="text-xs text-muted-foreground">
                        Recommended: 32x32 or 64x64 pixels, ICO or PNG format
                      </p>
                    </div>
                    {form.iconUrl && (
                      <div className="p-4 bg-muted rounded-lg">
                        <p className="text-xs text-muted-foreground mb-2">Preview:</p>
                        <img 
                          src={form.iconUrl} 
                          alt="Icon Preview" 
                          className="w-8 h-8 object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Brand Color */}
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Paintbrush className="w-5 h-5" />
                      Brand Color
                    </CardTitle>
                    <CardDescription>Primary color used throughout the application</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="space-y-2 flex-1">
                        <Label>Primary Color (Hex)</Label>
                        <div className="flex gap-2">
                          <Input
                            value={form.brandColor}
                            onChange={(e) => setForm({ ...form, brandColor: e.target.value })}
                            placeholder="#3b82f6"
                            className="flex-1"
                          />
                          <input
                            type="color"
                            value={form.brandColor || '#3b82f6'}
                            onChange={(e) => setForm({ ...form, brandColor: e.target.value })}
                            className="w-12 h-10 rounded border cursor-pointer"
                          />
                        </div>
                      </div>
                      <div 
                        className="w-24 h-24 rounded-lg shadow-inner border"
                        style={{ backgroundColor: form.brandColor || '#3b82f6' }}
                      />
                    </div>
                    <div className="flex gap-2">
                      {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'].map(color => (
                        <button
                          key={color}
                          className="w-8 h-8 rounded-full border-2 border-transparent hover:border-foreground transition-colors"
                          style={{ backgroundColor: color }}
                          onClick={() => setForm({ ...form, brandColor: color })}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Receipt Branding Tab */}
            <TabsContent value="receipts" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-6">
                  {/* Receipt Logo */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Image className="w-5 h-5" />
                        Receipt Logo
                      </CardTitle>
                      <CardDescription>Logo displayed at the top of receipts (can differ from main logo)</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Receipt Logo URL</Label>
                        <Input
                          value={form.receiptLogoUrl}
                          onChange={(e) => setForm({ ...form, receiptLogoUrl: e.target.value })}
                          placeholder="https://example.com/receipt-logo.png"
                        />
                        <p className="text-xs text-muted-foreground">
                          Leave empty to use main logo. For thermal printers: black & white, 200px wide
                        </p>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Show Logo on Receipts</Label>
                          <p className="text-xs text-muted-foreground">Display logo at the top of printed receipts</p>
                        </div>
                        <Switch
                          checked={form.receiptShowLogo}
                          onCheckedChange={(v) => setForm({ ...form, receiptShowLogo: v })}
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Custom Messages */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="w-5 h-5" />
                        Custom Messages
                      </CardTitle>
                      <CardDescription>Add personalized text to receipts</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Header Message (Optional)</Label>
                        <Textarea
                          value={form.receiptHeaderText}
                          onChange={(e) => setForm({ ...form, receiptHeaderText: e.target.value })}
                          placeholder="Welcome! Thank you for visiting."
                          rows={2}
                        />
                        <p className="text-xs text-muted-foreground">Displayed below the store info</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Footer Message</Label>
                        <Textarea
                          value={form.receiptFooterText}
                          onChange={(e) => setForm({ ...form, receiptFooterText: e.target.value })}
                          placeholder="Thank you for shopping with us!&#10;Returns accepted within 30 days.&#10;Follow us @mystore"
                          rows={4}
                        />
                        <p className="text-xs text-muted-foreground">Use new lines for multiple messages</p>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Show Barcode</Label>
                          <p className="text-xs text-muted-foreground">Display order barcode for easy scanning</p>
                        </div>
                        <Switch
                          checked={form.receiptShowBarcode}
                          onCheckedChange={(v) => setForm({ ...form, receiptShowBarcode: v })}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Receipt Preview */}
                <Card className="lg:sticky lg:top-6">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Eye className="w-5 h-5" />
                      Receipt Preview
                    </CardTitle>
                    <CardDescription>How your receipt will look</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-white text-black p-6 rounded-lg shadow-inner border-2 border-dashed font-mono text-sm max-w-[320px] mx-auto">
                      {/* Logo */}
                      {form.receiptShowLogo && (form.receiptLogoUrl || form.logoUrl) && (
                        <div className="text-center mb-4">
                          <img 
                            src={form.receiptLogoUrl || form.logoUrl} 
                            alt="Store Logo" 
                            className="max-h-16 mx-auto"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                      )}

                      {/* Store Info */}
                      <div className="text-center mb-4">
                        <p className="font-bold text-lg">{form.storeName || 'Store Name'}</p>
                        {form.storeNumber && <p className="text-xs">Store #{form.storeNumber}</p>}
                        {form.storeAddress && <p className="text-xs">{form.storeAddress}</p>}
                        {(form.storeCity || form.storeState || form.storeZip) && (
                          <p className="text-xs">
                            {form.storeCity}{form.storeCity && form.storeState ? ', ' : ''}{form.storeState} {form.storeZip}
                          </p>
                        )}
                        {form.storePhone && <p className="text-xs">Tel: {form.storePhone}</p>}
                      </div>

                      {/* Header Text */}
                      {form.receiptHeaderText && (
                        <div className="text-center mb-4 text-xs italic">
                          {form.receiptHeaderText}
                        </div>
                      )}

                      <Separator className="my-3 border-dashed" />

                      {/* Sample Items */}
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span>Sample Item 1</span>
                          <span>$10.00</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Sample Item 2 x2</span>
                          <span>$15.00</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Sample Item 3</span>
                          <span>$8.50</span>
                        </div>
                      </div>

                      <Separator className="my-3 border-dashed" />

                      {/* Totals */}
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span>Subtotal</span>
                          <span>$33.50</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Tax</span>
                          <span>$2.68</span>
                        </div>
                        <div className="flex justify-between font-bold text-sm">
                          <span>TOTAL</span>
                          <span>$36.18</span>
                        </div>
                      </div>

                      <Separator className="my-3 border-dashed" />

                      {/* Transaction Info */}
                      <div className="text-center text-xs space-y-1">
                        <p>{new Date().toLocaleString()}</p>
                        <p>Order #ABC12345</p>
                        <p>Payment: CASH</p>
                      </div>

                      {/* Barcode placeholder */}
                      {form.receiptShowBarcode && (
                        <div className="mt-4 text-center">
                          <div className="inline-block bg-black h-12 w-48 mx-auto"></div>
                          <p className="text-xs mt-1">*ABC12345*</p>
                        </div>
                      )}

                      {/* Footer */}
                      {form.receiptFooterText && (
                        <>
                          <Separator className="my-3 border-dashed" />
                          <div className="text-center text-xs whitespace-pre-line">
                            {form.receiptFooterText}
                          </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}

