import { useState, useEffect, useRef } from 'react';
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
  Building2, Phone, Mail, Globe, Paintbrush, Upload, X, Loader2
} from 'lucide-react';
import { updateBrandColor } from '@/components/BrandThemeProvider';
import { authStore } from '@/lib/auth-store';

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
  
  // File upload refs
  const logoInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const receiptLogoInputRef = useRef<HTMLInputElement>(null);
  
  // Upload loading states
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [uploadingReceiptLogo, setUploadingReceiptLogo] = useState(false);

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
  
  // File upload handler
  const handleFileUpload = async (
    file: File, 
    type: 'logo' | 'icon' | 'receipt-logo',
    setLoading: (loading: boolean) => void,
    fieldName: keyof BrandingSettings
  ) => {
    if (!file) return;
    
    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'];
    if (!allowedTypes.includes(file.type)) {
      toast({ 
        title: 'Invalid file type', 
        description: 'Please upload a PNG, JPG, GIF, SVG, WebP, or ICO file.',
        variant: 'destructive' 
      });
      return;
    }
    
    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast({ 
        title: 'File too large', 
        description: 'Please upload a file smaller than 5MB.',
        variant: 'destructive' 
      });
      return;
    }
    
    setLoading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const token = authStore.getToken();
      const apiType = type === 'receipt-logo' ? 'logo' : type;
      
      const response = await fetch(`/api/upload/${apiType}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });
      
      const result = await response.json();
      
      if (result.success) {
        setForm(prev => ({ ...prev, [fieldName]: result.data.url }));
        toast({ title: 'File uploaded successfully' });
      } else {
        throw new Error(result.message || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast({ 
        title: 'Upload failed', 
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive' 
      });
    } finally {
      setLoading(false);
    }
  };

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
      // Apply brand color immediately
      if (form.brandColor) {
        updateBrandColor(form.brandColor);
      }
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
                    {/* Upload Section */}
                    <div className="space-y-2">
                      <Label>Upload Logo</Label>
                      <div className="flex gap-2">
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/gif,image/svg+xml,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload(file, 'logo', setUploadingLogo, 'logoUrl');
                            e.target.value = '';
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1"
                          onClick={() => logoInputRef.current?.click()}
                          disabled={uploadingLogo}
                        >
                          {uploadingLogo ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4 mr-2" />
                              Choose File
                            </>
                          )}
                        </Button>
                        {form.logoUrl && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setForm({ ...form, logoUrl: '' })}
                            title="Remove logo"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Recommended: 200x80 pixels, PNG or SVG format. Max 5MB.
                      </p>
                    </div>
                    
                    {/* Or enter URL */}
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">Or enter URL</span>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Input
                        value={form.logoUrl}
                        onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                        placeholder="https://example.com/logo.png"
                      />
                    </div>
                    
                    {/* Preview */}
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
                    {/* Upload Section */}
                    <div className="space-y-2">
                      <Label>Upload Favicon</Label>
                      <div className="flex gap-2">
                        <input
                          ref={iconInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/gif,image/x-icon,image/vnd.microsoft.icon,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload(file, 'icon', setUploadingIcon, 'iconUrl');
                            e.target.value = '';
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1"
                          onClick={() => iconInputRef.current?.click()}
                          disabled={uploadingIcon}
                        >
                          {uploadingIcon ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4 mr-2" />
                              Choose File
                            </>
                          )}
                        </Button>
                        {form.iconUrl && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setForm({ ...form, iconUrl: '' })}
                            title="Remove icon"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Recommended: 32x32 or 64x64 pixels, ICO or PNG format. Max 5MB.
                      </p>
                    </div>
                    
                    {/* Or enter URL */}
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">Or enter URL</span>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Input
                        value={form.iconUrl}
                        onChange={(e) => setForm({ ...form, iconUrl: e.target.value })}
                        placeholder="https://example.com/favicon.ico"
                      />
                    </div>
                    
                    {/* Preview */}
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
                    <CardDescription>Primary color used throughout the application (buttons, links, accents)</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="space-y-2 flex-1">
                        <Label>Primary Color (Hex)</Label>
                        <div className="flex gap-2">
                          <Input
                            value={form.brandColor}
                            onChange={(e) => {
                              setForm({ ...form, brandColor: e.target.value });
                            }}
                            placeholder="#3b82f6"
                            className="flex-1"
                          />
                          <input
                            type="color"
                            value={form.brandColor || '#3b82f6'}
                            onChange={(e) => {
                              setForm({ ...form, brandColor: e.target.value });
                              updateBrandColor(e.target.value); // Live preview
                            }}
                            className="w-12 h-10 rounded border cursor-pointer"
                          />
                        </div>
                      </div>
                      <div 
                        className="w-24 h-24 rounded-lg shadow-inner border"
                        style={{ backgroundColor: form.brandColor || '#3b82f6' }}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-muted-foreground mr-2">Quick colors:</span>
                      {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'].map(color => (
                        <button
                          key={color}
                          className="w-8 h-8 rounded-full border-2 border-transparent hover:border-foreground transition-colors hover:scale-110"
                          style={{ backgroundColor: color }}
                          onClick={() => {
                            setForm({ ...form, brandColor: color });
                            updateBrandColor(color); // Live preview
                          }}
                          title={color}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Color changes preview instantly. Click "Save All Changes" to make permanent.
                    </p>
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
                      {/* Upload Section */}
                      <div className="space-y-2">
                        <Label>Upload Receipt Logo</Label>
                        <div className="flex gap-2">
                          <input
                            ref={receiptLogoInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/gif,image/svg+xml,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleFileUpload(file, 'receipt-logo', setUploadingReceiptLogo, 'receiptLogoUrl');
                              e.target.value = '';
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="flex-1"
                            onClick={() => receiptLogoInputRef.current?.click()}
                            disabled={uploadingReceiptLogo}
                          >
                            {uploadingReceiptLogo ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Uploading...
                              </>
                            ) : (
                              <>
                                <Upload className="w-4 h-4 mr-2" />
                                Choose File
                              </>
                            )}
                          </Button>
                          {form.receiptLogoUrl && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => setForm({ ...form, receiptLogoUrl: '' })}
                              title="Remove receipt logo"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          For thermal printers: black & white, 200px wide recommended. Max 5MB.
                        </p>
                      </div>
                      
                      {/* Or enter URL */}
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-card px-2 text-muted-foreground">Or enter URL</span>
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <Input
                          value={form.receiptLogoUrl}
                          onChange={(e) => setForm({ ...form, receiptLogoUrl: e.target.value })}
                          placeholder="https://example.com/receipt-logo.png"
                        />
                        <p className="text-xs text-muted-foreground">
                          Leave empty to use main logo
                        </p>
                      </div>
                      
                      {/* Receipt Logo Preview */}
                      {form.receiptLogoUrl && (
                        <div className="p-4 bg-muted rounded-lg">
                          <p className="text-xs text-muted-foreground mb-2">Preview:</p>
                          <img 
                            src={form.receiptLogoUrl} 
                            alt="Receipt Logo Preview" 
                            className="max-h-12 object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                      )}
                      
                      <Separator />
                      
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

