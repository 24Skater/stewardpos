import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Monitor, Receipt, Volume2, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { useToast } from "@/hooks/use-toast";

const STORAGE_KEY = "steward-terminal-settings";

interface TerminalSettings {
  terminalName: string;
  receiptDefault: "ask" | "print" | "email" | "skip";
  soundEnabled: boolean;
}

const defaultSettings: TerminalSettings = {
  terminalName: "",
  receiptDefault: "ask",
  soundEnabled: true,
};

function loadFromStorage(): TerminalSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    // ignore corrupt storage
  }
  return defaultSettings;
}

export default function Settings() {
  const [settings, setSettings] = useState<TerminalSettings>(loadFromStorage);
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    toast({ title: "Terminal settings saved" });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 py-3 shadow-sm sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/")}
              className="hover:bg-secondary"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">Register Settings</h1>
              <p className="text-xs text-muted-foreground">Settings for this terminal only</p>
            </div>
          </div>
          <Button onClick={handleSave} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <Save className="w-4 h-4 mr-2" />
            Save
          </Button>
        </div>
      </header>

      <div className="p-6 max-w-2xl mx-auto space-y-6">
        {/* Terminal */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Monitor className="w-5 h-5" />
              Terminal
            </CardTitle>
            <CardDescription>Identify this register in reports</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="terminalName" className="text-foreground">Terminal Name</Label>
              <Input
                id="terminalName"
                value={settings.terminalName}
                onChange={(e) => setSettings({ ...settings, terminalName: e.target.value })}
                className="bg-background border-border"
                placeholder="e.g. Register 1, Welcome Desk"
              />
            </div>
          </CardContent>
        </Card>

        {/* Receipt */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Receipt
            </CardTitle>
            <CardDescription>Default receipt action after checkout</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="receiptDefault" className="text-foreground">Default Action</Label>
              <Select
                value={settings.receiptDefault}
                onValueChange={(value: TerminalSettings["receiptDefault"]) =>
                  setSettings({ ...settings, receiptDefault: value })
                }
              >
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ask">Ask every time</SelectItem>
                  <SelectItem value="print">Always print</SelectItem>
                  <SelectItem value="email">Always email</SelectItem>
                  <SelectItem value="skip">Skip receipt</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Display & Sound */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Volume2 className="w-5 h-5" />
              Display & Sound
            </CardTitle>
            <CardDescription>Visual and audio preferences for this terminal</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-foreground">Dark Mode</Label>
                <p className="text-sm text-muted-foreground">Switch between light and dark theme</p>
              </div>
              <Switch
                checked={theme === "dark"}
                onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-foreground">Checkout Sound</Label>
                <p className="text-sm text-muted-foreground">Play a sound when a sale completes</p>
              </div>
              <Switch
                checked={settings.soundEnabled}
                onCheckedChange={(checked) => setSettings({ ...settings, soundEnabled: checked })}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
