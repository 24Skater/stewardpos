import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Upload, X } from 'lucide-react';
import { uploadApi, type UploadKind } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';

/** What `backend/src/api/routes/upload.ts` accepts; it re-checks the bytes. */
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/x-icon';

interface ImageUploadFieldProps {
  id: string;
  label: string;
  kind: UploadKind;
  value: string | undefined;
  onChange: (url: string) => void;
  placeholder?: string;
  hint?: string;
}

/** An image setting: upload a file, or paste a URL. Shows what is set now. */
export default function ImageUploadField({ id, label, kind, value, onChange, placeholder, hint }: ImageUploadFieldProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadApi.upload(kind, file);
      onChange(uploaded.url);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'The image could not be uploaded'));
    } finally {
      setUploading(false);
      // Let the same file be picked again after a failure.
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        {value && (
          <img
            src={value}
            alt={`Current ${label.toLowerCase()}`}
            className="h-12 w-12 shrink-0 rounded border border-border bg-muted object-contain"
          />
        )}
        <Input id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          aria-label={`Upload ${label.toLowerCase()} file`}
          onChange={(e) => upload(e.target.files?.[0])}
        />
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          Upload
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange('')} aria-label={`Remove ${label.toLowerCase()}`}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
