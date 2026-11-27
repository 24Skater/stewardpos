import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Palette } from 'lucide-react';
import type { Settings } from '@/lib/api';
import { brandProperties, isBrandColor } from '@/lib/brand-theme';
import ImageUploadField from './ImageUploadField';

interface BrandingSettingsProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

/** The design system's own gold, offered when a store has chosen nothing. */
const DEFAULT_BRAND = '#E8B847';

/**
 * Store identity: logo, favicon, brand colour, and the receipt's own wording.
 *
 * These columns have existed since the branding migration and the API has always
 * accepted them — there was simply no way to set them, so `brandColor` was a
 * validated field nothing could write and nothing read. This is both halves.
 *
 * The colour preview is rendered with the same `brandProperties` the whole app
 * is themed with, so what a store sees here is what it will get rather than an
 * approximation maintained separately.
 */
export default function BrandingSettings({ settings, onChange }: BrandingSettingsProps) {
  const brandColor = isBrandColor(settings.brandColor) ? settings.brandColor : DEFAULT_BRAND;
  const preview = brandProperties(brandColor);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Brand
          </CardTitle>
          <CardDescription>
            Your colour and marks, applied across the register, the admin screens and exported
            reports.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="brandColor">Brand colour</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="brandColor"
                  type="color"
                  className="h-10 w-16 p-1"
                  value={brandColor}
                  onChange={(e) => onChange({ brandColor: e.target.value })}
                />
                <Input
                  aria-label="Brand colour hex value"
                  className="font-mono"
                  value={brandColor}
                  onChange={(e) => onChange({ brandColor: e.target.value })}
                  placeholder="#E8B847"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Six-digit hex. Text on the colour is chosen automatically for contrast.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Preview</Label>
              <div
                className="flex h-10 items-center justify-center rounded-md text-sm font-semibold"
                style={{
                  background: preview['--st-primary'],
                  color: preview['--st-primaryFg'],
                }}
              >
                Charge {settings.storeName || 'your store'}
              </div>
              <p className="text-xs text-muted-foreground">
                Takes effect across the app once saved.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <ImageUploadField
              id="logoUrl"
              label="Logo"
              kind="logo"
              value={settings.logoUrl}
              onChange={(logoUrl) => onChange({ logoUrl })}
              placeholder="Upload an image, or paste https://…"
              hint="Shown in the register header."
            />
            <ImageUploadField
              id="iconUrl"
              label="Favicon"
              kind="icon"
              value={settings.iconUrl}
              onChange={(iconUrl) => onChange({ iconUrl })}
              placeholder="Upload an image, or paste https://…"
              hint="Shown in the browser tab. A small square image works best."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Receipts</CardTitle>
          <CardDescription>
            What a customer reads on the receipt, printed and emailed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label htmlFor="receiptShowLogo">Show the logo on receipts</Label>
              <p className="text-xs text-muted-foreground">
                Uses the receipt logo below, or the store logo if that is blank.
              </p>
            </div>
            <Switch
              id="receiptShowLogo"
              checked={settings.receiptShowLogo !== false}
              onCheckedChange={(checked) => onChange({ receiptShowLogo: checked })}
            />
          </div>

          <ImageUploadField
            id="receiptLogoUrl"
            label="Receipt logo"
            kind="logo"
            value={settings.receiptLogoUrl}
            onChange={(receiptLogoUrl) => onChange({ receiptLogoUrl })}
            placeholder="Upload an image, or paste https://…"
            hint="Thermal printers print in black only; a high-contrast black-and-white logo prints best."
          />

          <div className="space-y-2">
            <Label htmlFor="receiptHeaderText">Header text</Label>
            <Textarea
              id="receiptHeaderText"
              rows={2}
              value={settings.receiptHeaderText ?? ''}
              onChange={(e) => onChange({ receiptHeaderText: e.target.value })}
              placeholder="Thank you for supporting our ministry"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="receiptFooterText">Footer text</Label>
            <Textarea
              id="receiptFooterText"
              rows={2}
              value={settings.receiptFooterText ?? ''}
              onChange={(e) => onChange({ receiptFooterText: e.target.value })}
              placeholder="Returns accepted within 30 days with this receipt"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
