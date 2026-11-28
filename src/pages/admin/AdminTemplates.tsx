import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import AdminLayout from '@/components/AdminLayout';
import { adminApi, type MessageTemplate, type TemplatePreview } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/errors';

const idOf = (t: MessageTemplate) => `${t.key}:${t.channel}`;
const payload = (t: MessageTemplate) => ({ subject: t.subject, body: t.body, enabled: t.enabled });

export default function AdminTemplates() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [draft, setDraft] = useState<MessageTemplate | null>(null);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);

  const load = useCallback(async () => {
    try {
      setTemplates(await adminApi.templates.list());
    } catch (error: unknown) {
      toast({ title: 'Could not load templates', description: getErrorMessage(error), variant: 'destructive' });
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const select = (t: MessageTemplate) => {
    setDraft(t);
    setPreview(null);
  };

  const save = async () => {
    if (!draft) return;
    try {
      await adminApi.templates.save(draft.key, draft.channel, payload(draft));
      toast({ title: 'Template saved' });
      await load();
    } catch (error: unknown) {
      toast({ title: 'Could not save template', description: getErrorMessage(error), variant: 'destructive' });
    }
  };

  const runPreview = async () => {
    if (!draft) return;
    try {
      setPreview(await adminApi.templates.preview(draft.key, draft.channel, payload(draft)));
    } catch (error: unknown) {
      toast({ title: 'Could not preview', description: getErrorMessage(error), variant: 'destructive' });
    }
  };

  return (
    <AdminLayout>
      <div className="p-8">
        <h1 className="text-3xl font-bold text-foreground">Message templates</h1>
        <p className="mb-6 text-muted-foreground">Edit the wording of each message, or switch one off</p>

        <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
          <ul className="space-y-1" aria-label="Templates">
            {templates.map((t) => (
              <li key={idOf(t)}>
                <Button
                  variant={draft && idOf(draft) === idOf(t) ? 'secondary' : 'ghost'}
                  className="w-full justify-start"
                  onClick={() => select(t)}
                >
                  {t.key} ({t.channel}){t.enabled ? '' : ' - off'}
                </Button>
              </li>
            ))}
          </ul>

          {draft && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="template-enabled"
                  checked={draft.enabled}
                  onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
                />
                <Label htmlFor="template-enabled">Send this message</Label>
              </div>
              <div>
                <Label htmlFor="template-subject">Subject</Label>
                <Input
                  id="template-subject"
                  value={draft.subject}
                  onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="template-body">Body</Label>
                <Textarea
                  id="template-body"
                  rows={8}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
                <p className="mt-1 text-sm text-muted-foreground">
                  Variables: {draft.vars.map((v) => `{{${v}}}`).join(', ')}
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => void save()}>Save</Button>
                <Button variant="outline" onClick={() => void runPreview()}>
                  Preview
                </Button>
              </div>
              {preview && (
                <div className="rounded-md border p-4" aria-label="Preview">
                  <p className="font-semibold">{preview.subject}</p>
                  <pre className="mt-2 whitespace-pre-wrap text-sm">{preview.text}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
