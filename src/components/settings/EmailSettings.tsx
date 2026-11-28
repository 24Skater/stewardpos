import { useState } from 'react';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminApi, type Settings } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/errors';

type Provider = 'off' | 'smtp' | 'resend';
type Credentials = Record<string, string>;

interface EmailSettingsProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

interface Field {
  key: string;
  label: string;
  secret?: boolean;
}

const FIELDS: Record<Exclude<Provider, 'off'>, Field[]> = {
  smtp: [
    { key: 'host', label: 'SMTP host' },
    { key: 'port', label: 'Port' },
    { key: 'user', label: 'Username' },
    { key: 'password', label: 'Password', secret: true },
    { key: 'from', label: 'From address' },
  ],
  resend: [
    { key: 'apiKey', label: 'API key', secret: true },
    { key: 'from', label: 'From address' },
  ],
};

function currentEntry(settings: Settings): { provider: Provider; credentials: Credentials } {
  const entry = settings.providers?.email;
  if (typeof entry === 'string') return { provider: entry as Provider, credentials: {} };
  const { provider, credentials } = (entry ?? {}) as { provider?: Provider; credentials?: Credentials };
  return { provider: provider ?? 'off', credentials: credentials ?? {} };
}

/** Stored secrets arrive encrypted; they are never shown, and blank keeps them. */
const isStoredSecret = (value: string | undefined) => Boolean(value?.startsWith('enc:v1:'));

/** Email provider choice, credentials, and a test send. */
export default function EmailSettings({ settings, onChange }: EmailSettingsProps) {
  const { toast } = useToast();
  const { provider, credentials } = currentEntry(settings);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);

  const update = (next: { provider?: Provider; credentials?: Credentials }) => {
    const entry = { provider, credentials, ...next };
    onChange({ providers: { ...settings.providers, email: entry } });
  };

  const setField = (key: string, value: string) => {
    const next = { ...credentials };
    if (value === '' && isStoredSecret(credentials[key])) return;
    next[key] = value;
    update({ credentials: next });
  };

  const sendTest = async () => {
    try {
      setTesting(true);
      const result = await adminApi.email.test(testTo);
      toast({
        title: result.status === 'sent' ? 'Test email sent' : `Test email ${result.status}`,
        description: result.detail,
        variant: result.status === 'failed' ? 'destructive' : 'default',
      });
    } catch (error: unknown) {
      toast({ title: 'Test email failed', description: getErrorMessage(error), variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email
        </CardTitle>
        <CardDescription>
          Choose how receipts and notices are sent. Off means nothing is sent. Save before testing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email-provider">Provider</Label>
          <Select value={provider} onValueChange={(value) => update({ provider: value as Provider })}>
            <SelectTrigger id="email-provider" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="smtp">SMTP</SelectItem>
              <SelectItem value="resend">Resend</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {provider !== 'off' && (
          <div className="grid gap-3 md:grid-cols-2">
            {FIELDS[provider].map(({ key, label, secret }) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`email-${key}`}>{label}</Label>
                <Input
                  id={`email-${key}`}
                  type={secret ? 'password' : 'text'}
                  autoComplete="off"
                  placeholder={isStoredSecret(credentials[key]) ? 'Stored - leave blank to keep' : ''}
                  value={isStoredSecret(credentials[key]) ? '' : (credentials[key] ?? '')}
                  onChange={(e) => setField(key, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="space-y-2">
            <Label htmlFor="email-test-to">Send a test to</Label>
            <Input
              id="email-test-to"
              type="email"
              className="w-72"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
          </div>
          <Button type="button" variant="outline" onClick={() => void sendTest()} disabled={testing || !testTo}>
            {testing ? 'Sending...' : 'Test send'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
