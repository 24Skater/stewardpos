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
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api-client';
import { Receipt, Upload, Store, MapPin, Phone, Image, FileText, Save, Eye } from 'lucide-react';

interface ReceiptSettings {
  storeName: string;
  storePhone: string;
  storeEmail: string;
  storeAddress: string;
  storeCity: string;
  storeState: string;
  storeZip: string;
  storeNumber: string;
  receiptLogoUrl: string;
  receiptHeaderText: string;
  receiptFooterText: string;
  receiptShowLogo: boolean;
  receiptShowBarcode: boolean;
}

export default function AdminReceiptBranding() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [previewMode, setPreviewMode] = useState(false);

  const [form, setForm] = useState<ReceiptSettings>({
    storeName: '',
    storePhone: '',
    storeEmail: '',
    storeAddress: '',
    storeCity: '',
    storeState: '',
    storeZip: '',
    storeNumber: '',
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
        receiptLogoUrl: settings.receiptLogoUrl || '',
        receiptHeaderText: settings.receiptHeaderText || '',
        receiptFooterText: settings.receiptFooterText || '',
        receiptShowLogo: settings.receiptShowLogo !== false,
        receiptShowBarcode: settings.receiptShowBarcode !== false,
      });
    }
  }, [settings]);

  const updateSettings = useMutation({
    mutationFn: (data: Partial<ReceiptSettings>) => 
      apiClient.put('/api/admin/settings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast({ title: 'Receipt branding saved successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to save settings', variant: 'destructive' });
    },
  });

  const handleSave = () => {
    updateSettings.mutate(form);
  };

  const formatAddress = () => {
    const parts = [form.storeAddress];
    if (form.storeCity || form.storeState || form.storeZip) {
      parts.push(`${form.storeCity}${form.storeCity && form.storeState ? ', ' : ''}${form.storeState} ${form.storeZip}`.trim());
    }
    return parts.filter(Boolean).join('\n');
  };

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Receipt className="w-8 h-8" />
                Receipt Branding
              </h1>
              <p className="text-muted-foreground">Customize how your receipts look with your logo and store information</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPreviewMode(!previewMode)}>
                <Eye className="w-4 h-4 mr-2" />
                {previewMode ? 'Hide Preview' : 'Preview'}
              </Button>
              <Button onClick={handleSave} disabled={updateSettings.isPending}>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Settings Form */}
            <div className="space-y-6">
              {/* Store Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Store className="w-5 h-5" />
                    Store Information
                  </CardTitle>
                  <CardDescription>Basic information shown on receipts</CardDescription>
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
                      <Label>Store Number</Label>
                      <Input
                        value={form.storeNumber}
                        onChange={(e) => setForm({ ...form, storeNumber: e.target.value })}
                        placeholder="#001"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input
                        value={form.storePhone}
                        onChange={(e) => setForm({ ...form, storePhone: e.target.value })}
                        placeholder="(555) 123-4567"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={form.storeEmail}
                        onChange={(e) => setForm({ ...form, storeEmail: e.target.value })}
                        placeholder="store@example.com"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Location */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="w-5 h-5" />
                    Location
                  </CardTitle>
                  <CardDescription>Store address for receipts</CardDescription>
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
                      <Label>State</Label>
                      <Input
                        value={form.storeState}
                        onChange={(e) => setForm({ ...form, storeState: e.target.value })}
                        placeholder="NY"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>ZIP Code</Label>
                      <Input
                        value={form.storeZip}
                        onChange={(e) => setForm({ ...form, storeZip: e.target.value })}
                        placeholder="10001"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Logo */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Image className="w-5 h-5" />
                    Receipt Logo
                  </CardTitle>
                  <CardDescription>Logo displayed at the top of receipts</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Logo URL</Label>
                    <Input
                      value={form.receiptLogoUrl}
                      onChange={(e) => setForm({ ...form, receiptLogoUrl: e.target.value })}
                      placeholder="https://example.com/logo.png"
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter a URL to your logo image. Recommended size: 200x80 pixels
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

              {/* Custom Text */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Custom Messages
                  </CardTitle>
                  <CardDescription>Add custom text to your receipts</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Header Text (Optional)</Label>
                    <Textarea
                      value={form.receiptHeaderText}
                      onChange={(e) => setForm({ ...form, receiptHeaderText: e.target.value })}
                      placeholder="Welcome to our store!"
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">Displayed below the logo/store info</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Footer Text</Label>
                    <Textarea
                      value={form.receiptFooterText}
                      onChange={(e) => setForm({ ...form, receiptFooterText: e.target.value })}
                      placeholder="Thank you for shopping with us!&#10;Returns accepted within 30 days with receipt.&#10;Follow us @mystore"
                      rows={4}
                    />
                    <p className="text-xs text-muted-foreground">Custom message at the bottom of receipts. Use new lines for multiple messages.</p>
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

            {/* Preview */}
            {previewMode && (
              <div className="lg:sticky lg:top-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Receipt Preview</CardTitle>
                    <CardDescription>How your receipt will look</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-white text-black p-6 rounded-lg shadow-inner border-2 border-dashed font-mono text-sm max-w-[320px] mx-auto">
                      {/* Logo */}
                      {form.receiptShowLogo && form.receiptLogoUrl && (
                        <div className="text-center mb-4">
                          <img 
                            src={form.receiptLogoUrl} 
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
                        <p>Dec 29, 2025 12:30 PM</p>
                        <p>Order #ABC12345</p>
                        <p>Payment: Cash</p>
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
            )}
          </div>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}

