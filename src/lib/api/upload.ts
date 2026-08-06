import { apiClient } from '../api-client';

export type UploadKind = 'logo' | 'icon' | 'favicon';

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
 * Admin/manager only, 5 MB per file, enforced server-side.
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
