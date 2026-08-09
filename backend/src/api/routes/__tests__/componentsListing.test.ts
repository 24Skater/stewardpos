import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Listing the installed components and their available updates.
 *
 * These endpoints report what versions the deployment is running, which is what
 * an operator reads before deciding to update — and updating is the route that
 * once had an `exec` interpolation in it. `componentUpdate.test.ts` covers the
 * updating; this covers the reading, and specifically the access control.
 *
 * They carry `requirePermission('settings', 'read')` **and** a manual admin
 * check. The doubling is deliberate: a shop can grant settings-read to someone
 * who should not be reading the dependency inventory of the host, and it is the
 * inner check that stops them.
 */
const getUserByEmail = vi.fn();

vi.mock('../../../services/database', () => ({
  default: { getAdapter: () => ({ getUserByEmail }) },
}));

/**
 * `/updates` shells out to `npm view <pkg> version` once per component — a real
 * network round trip each, sequentially. Left unmocked the test hits the public
 * registry and times out in CI, which is what happened on the first run of this
 * file. Mocked here so the endpoint's own logic is what gets exercised.
 *
 * Worth noting separately: that design makes the endpoint slow and dependent on
 * the registry being reachable, with no caching. It is admin-triggered, so it is
 * a tolerable cost rather than an urgent one.
 */
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFile: (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      callback?: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      const done = typeof _opts === 'function' ? (_opts as typeof callback) : callback;
      done?.(null, '99.0.0\n', '');
      return undefined as never;
    },
  };
});

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const BASE = '/api/admin/components';

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function person(systemRole: string, permissions: Record<string, unknown> = { settings: { read: true } }) {
  return {
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Role', systemRole, permissions }],
  };
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(person('admin', {}));
});

describe('GET /api/admin/components', () => {
  it('lists what is installed', async () => {
    const response = await request(app).get(BASE).set(auth());

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('reports a version for each component it finds', async () => {
    // Read from the real package.json files on disk, so this also confirms the
    // path resolution works from wherever the process was started.
    const response = await request(app).get(BASE).set(auth());

    for (const component of response.body.data) {
      expect(component.currentVersion, JSON.stringify(component)).toBeTruthy();
    }
  });

  it('refuses a non-admin even when they hold settings.read', async () => {
    // The inner check is the one that matters: a shop can reasonably give
    // settings-read to a manager who has no business reading the host's
    // dependency inventory.
    getUserByEmail.mockResolvedValue(person('standard', { settings: { read: true } }));

    const response = await request(app).get(BASE).set(auth());

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/admin/i);
  });

  it('refuses someone with no settings permission at all', async () => {
    getUserByEmail.mockResolvedValue(person('standard', { settings: { read: false } }));

    expect((await request(app).get(BASE).set(auth())).status).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it('refuses a user who has vanished since their token was issued', async () => {
    getUserByEmail.mockResolvedValue(null);

    expect((await request(app).get(BASE).set(auth())).status).toBeGreaterThanOrEqual(401);
  });
});

describe('GET /api/admin/components/updates', () => {
  it('reports what could be updated', async () => {
    const response = await request(app).get(`${BASE}/updates`).set(auth());

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('reports a component whose published version is newer', async () => {
    // The mocked registry always answers 99.0.0, so everything installed is
    // behind — which is what makes this assert the comparison rather than the
    // network.
    const response = await request(app).get(`${BASE}/updates`).set(auth());

    for (const update of response.body.data) {
      expect(update.latestVersion).toBe('99.0.0');
      expect(update.currentVersion).not.toBe('99.0.0');
    }
  });

  it('is admin-only too', async () => {
    getUserByEmail.mockResolvedValue(person('standard', { settings: { read: true } }));

    expect((await request(app).get(`${BASE}/updates`).set(auth())).status).toBe(403);
  });

  it('is not read as a component id', async () => {
    // `/updates` sits alongside the collection route; if a `/:name` route were
    // ever added above it, this would look up a component called "updates".
    const response = await request(app).get(`${BASE}/updates`).set(auth());

    expect(response.status).not.toBe(404);
  });
});
