import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSettings, saveSettings, Settings as SettingsType } from "@/lib/db";
import { ArrowLeft, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const [settings, setSettings] = useState<SettingsType>({
    taxRateDefault: 0.08,
    storeName: 'Persona Store',
    storeEmail: 'store@persona.com',
    storePhone: '(555) 123-4567',
  });
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const saved = await getSettings();
    if (saved) setSettings(saved);
  };

  const handleSave = async () => {
    await saveSettings(settings);
    toast({ title: "Settings saved successfully" });
  };

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
          <Button onClick={handleSave} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <Save className="w-4 h-4 mr-2" />
            Save
          </Button>
        </div>
      </header>

      <div className="p-6 max-w-2xl mx-auto">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Store Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="storeName" className="text-foreground">Store Name</Label>
              <Input
                id="storeName"
                value={settings.storeName}
                onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
                className="bg-background border-border"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="storeEmail" className="text-foreground">Store Email</Label>
              <Input
                id="storeEmail"
                type="email"
                value={settings.storeEmail}
                onChange={(e) => setSettings({ ...settings, storeEmail: e.target.value })}
                className="bg-background border-border"
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
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="taxRate" className="text-foreground">Default Tax Rate (%)</Label>
              <Input
                id="taxRate"
                type="number"
                step="0.01"
                value={(settings.taxRateDefault * 100).toFixed(2)}
                onChange={(e) => setSettings({ ...settings, taxRateDefault: parseFloat(e.target.value) / 100 || 0 })}
                className="bg-background border-border"
              />
              <p className="text-xs text-muted-foreground">
                Current: {(settings.taxRateDefault * 100).toFixed(2)}%
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
