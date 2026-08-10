import { apiClient } from '../api-client';

export type UploadKind = 'logo' | 'icon' | 'favicon' | 'product';

export interface UploadedFile {
  /** Relative URL (`/uploads/...`), so it survives being served behind a proxy. */
  url: string;
  filename: string;
  originalName: string;
  size: number;
  mimetype: string;
}

/**
 * File uploads (`backend/src/api/routes/upload.ts`).
 *
 * 5 MB per file and images only, both enforced server-side.
 *
 * Permission depends on the kind: `product` needs `inventory.write`, the rest
 * need `settings.write`. A product photo is catalog work, and requiring the
 * settings permission would mean nobody could add one without also being able
 * to change the store's payment credentials.
 */
export const uploadApi = {
  upload: (kind: UploadKind, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm<UploadedFile>(`/api/upload/${kind}`, form);
  },
  remove: (kind: UploadKind, filename: string) =>
    apiClient.delete<void>(`/api/upload/${kind}/${encodeURIComponent(filename)}`),
};
