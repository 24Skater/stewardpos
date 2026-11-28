export interface SiblingRequest {
  url: string;
  token?: string;
  method: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** A 3xx is returned as a failure instead of being followed to an unchecked host. */
  noRedirect?: boolean;
}

export type SiblingResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status?: number; error: string };

// Sibling apps must never block checkout, so every call is bounded.
const SIBLING_TIMEOUT_MS = 3000;

// Never throws: callers get a result they can branch on.
export async function callSibling(req: SiblingRequest): Promise<SiblingResult> {
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...req.headers };
    if (req.token) headers.authorization = `Bearer ${req.token}`;
    const res = await fetch(req.url, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(SIBLING_TIMEOUT_MS),
      redirect: req.noRedirect ? 'manual' : 'follow',
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    const text = await res.text();
    return { ok: true, status: res.status, data: text ? JSON.parse(text) : null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
