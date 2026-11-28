import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminApi, type Settings } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/errors';

type Provider = 'off' | 'twilio' | 'http';
type Credentials = Record<string, string>;
interface QuietHours {
  start?: string;
  end?: string;
}

interface SmsSettingsProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

interface Field {
  key: string;
  label: string;
  secret?: boolean;
}

const FIELDS: Record<Exclude<Provider, 'off'>, Field[]> = {
  twilio: [
    { key: 'accountSid', label: 'Account SID' },
    { key: 'authToken', label: 'Auth token', secret: true },
    { key: 'from', label: 'From number (+1...)' },
  ],
  http: [
    { key: 'url', label: 'Gateway URL' },
    { key: 'token', label: 'Bearer token', secret: true },
  ],
};

function currentEntry(settings: Settings): { provider: Provider; credentials: Credentials } {
  const entry = settings.providers?.sms;
  if (typeof entry === 'string') return { provider: entry as Provider, credentials: {} };
  const { provider, credentials } = (entry ?? {}) as { provider?: Provider; credentials?: Credentials };
  return { provider: provider ?? 'off', credentials: credentials ?? {} };
}

/** Stored secrets arrive encrypted; they are never shown, and blank keeps them. */
const isStoredSecret = (value: string | undefined) => Boolean(value?.startsWith('enc:v1:'));

/** SMS provider choice, credentials, quiet hours, and a test send. */
export default function SmsSettings({ settings, onChange }: SmsSettingsProps) {
  const { toast } = useToast();
  const { provider, credentials } = currentEntry(settings);
  const quiet = (settings.providers?.smsQuietHours ?? {}) as QuietHours;
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);

  const update = (next: { provider?: Provider; credentials?: Credentials }) => {
    const entry = { provider, credentials, ...next };
    onChange({ providers: { ...settings.providers, sms: entry } });
  };

  const setField = (key: string, value: string) => {
    if (value === '' && isStoredSecret(credentials[key])) return;
    update({ credentials: { ...credentials, [key]: value } });
  };

  const setQuiet = (patch: QuietHours) =>
    onChange({ providers: { ...settings.providers, smsQuietHours: { ...quiet, ...patch } } });

  const sendTest = async () => {
    try {
      setTesting(true);
      const result = await adminApi.sms.test(testTo);
      toast({
        title: result.status === 'sent' ? 'Test text sent' : `Test text ${result.status}`,
        description: result.detail,
        variant: result.status === 'failed' ? 'destructive' : 'default',
      });
    } catch (error: unknown) {
      toast({ title: 'Test text failed', description: getErrorMessage(error), variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          SMS
        </CardTitle>
        <CardDescription>
          Texts go only to customers who agreed to receive them, and never during quiet hours. Consent rules
          vary by state and country; check yours. Save before testing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="sms-provider">Provider</Label>
          <Select value={provider} onValueChange={(value) => update({ provider: value as Provider })}>
            <SelectTrigger id="sms-provider" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="twilio">Twilio</SelectItem>
              <SelectItem value="http">HTTP gateway</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {provider !== 'off' && (
          <div className="grid gap-3 md:grid-cols-2">
            {FIELDS[provider].map(({ key, label, secret }) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`sms-${key}`}>{label}</Label>
                <Input
                  id={`sms-${key}`}
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

        <div className="flex gap-4">
          <div className="space-y-2">
            <Label htmlFor="sms-quiet-start">Quiet hours start</Label>
            <Input id="sms-quiet-start" type="time" value={quiet.start ?? ''} onChange={(e) => setQuiet({ start: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sms-quiet-end">Quiet hours end</Label>
            <Input id="sms-quiet-end" type="time" value={quiet.end ?? ''} onChange={(e) => setQuiet({ end: e.target.value })} />
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div className="space-y-2">
            <Label htmlFor="sms-test-to">Send a test to (must have opted in)</Label>
            <Input id="sms-test-to" type="tel" className="w-72" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          </div>
          <Button type="button" variant="outline" onClick={() => void sendTest()} disabled={testing || !testTo}>
            {testing ? 'Sending...' : 'Test send'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
