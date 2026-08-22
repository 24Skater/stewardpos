import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../services/database', () => ({
  default: { getAdapter: () => ({}) },
}));

const { default: app } = await import('../../app');

/**
 * The preflight contract.
 *
 * `api-client.ts` attaches `X-Register-Id` to every request once a till has
 * been selected — including `POST /api/auth/login`, which never reads it. When
 * that header was missing from `allowedHeaders`, the browser refused the
 * preflight and sign-in was impossible from any origin not served through the
 * same proxy as the API. A header the client sends but the policy omits is
 * invisible to every same-origin test, so it is asserted here directly.
 */
const ORIGIN = 'http://localhost:8080';

/** What the browser compares the request's own headers against, lowercased. */
async function allowedHeaders(requested: string): Promise<string[]> {
  const response = await request(app)
    .options('/api/auth/login')
    .set('Origin', ORIGIN)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', requested);

  return (response.headers['access-control-allow-headers'] ?? '')
    .split(',')
    .map((header: string) => header.trim().toLowerCase())
    .filter(Boolean);
}

describe('CORS preflight', () => {
  it.each([
    ['content-type'],
    ['authorization'],
    // Sent on every request once a register is selected — see api-client.ts.
    ['x-register-id'],
    // Sent by an enrolled terminal alongside the id — see register-device.ts.
    ['x-register-token'],
    // Sent when a manager has authorised a restricted action — see api/drawer.ts.
    ['x-override-token'],
    // The server-to-server auth path — see middleware/auth.ts.
    ['x-api-key'],
  ])('allows %s, which the app reads', async (header) => {
    expect(await allowedHeaders(header)).toContain(header);
  });

  it('allows the exact header set login sends from a paired till', async () => {
    const sent = ['content-type', 'x-register-id', 'x-register-token'];

    const allowed = await allowedHeaders(sent.join(','));

    for (const header of sent) {
      expect(allowed).toContain(header);
    }
  });

  it('does not reflect arbitrary headers back to the caller', async () => {
    // A fixed allowlist, not an echo of whatever was asked for: reflecting the
    // request would make the policy a formality.
    expect(await allowedHeaders('x-anything-at-all')).not.toContain('x-anything-at-all');
  });
});
