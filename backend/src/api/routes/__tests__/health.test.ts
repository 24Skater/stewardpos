import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const testConnection = vi.fn();

vi.mock('../../../services/database', () => ({
  default: { testConnection: () => testConnection() },
}));

const { default: app } = await import('../../../app');
const { setStorageAdapter } = await import('../../../storage');

function store(verify: () => Promise<void>) {
  return {
    name: 'test store',
    put: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
    verify,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  testConnection.mockResolvedValue(true);
  setStorageAdapter(store(async () => undefined));
});

afterEach(() => {
  setStorageAdapter(null);
});

describe('GET /api/health', () => {
  it('is up even when the database is down, because it is a liveness probe', async () => {
    testConnection.mockRejectedValue(new Error('connection refused'));

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
  });
});

describe('GET /api/health/db', () => {
  it('reports healthy when both dependencies answer', async () => {
    const response = await request(app).get('/api/health/db');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.checks.database.ok).toBe(true);
    expect(response.body.checks.uploads.ok).toBe(true);
  });

  // The regression this endpoint existed to not catch. Before, the handler
  // returned `{ status: 'healthy' }` unconditionally.
  it('answers 503 when the database is unreachable', async () => {
    testConnection.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:5432'));

    const response = await request(app).get('/api/health/db');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unhealthy');
    expect(response.body.checks.database.ok).toBe(false);
  });

  // The endpoint is unauthenticated so a load balancer can poll it. A driver's
  // error message carries hosts, ports and sometimes credentials, so the reason
  // goes to the log and only the verdict goes on the wire.
  it('does not put the failure reason on the wire', async () => {
    testConnection.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:5432'));

    const response = await request(app).get('/api/health/db');

    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/ECONNREFUSED/);
    expect(body).not.toMatch(/10\.0\.0\.5/);
    expect(body).not.toMatch(/:\d{4}/);
  });

  it('answers 503 when the connection test returns false without throwing', async () => {
    testConnection.mockResolvedValue(false);

    const response = await request(app).get('/api/health/db');

    expect(response.status).toBe(503);
    expect(response.body.checks.database.ok).toBe(false);
  });

  it('answers 503 when the upload store is unreachable, with the database fine', async () => {
    setStorageAdapter(
      store(async () => {
        throw new Error('NoSuchBucket: stewardpos');
      })
    );

    const response = await request(app).get('/api/health/db');

    expect(response.status).toBe(503);
    expect(response.body.checks.database.ok).toBe(true);
    expect(response.body.checks.uploads.ok).toBe(false);
  });

  it('names which dependency failed rather than reporting a bare status', async () => {
    testConnection.mockRejectedValue(new Error('down'));

    const response = await request(app).get('/api/health/db');

    // Which one is wrong is safe to publish and is the useful half; why it is
    // wrong is not.
    expect(response.body.checks.database.ok).toBe(false);
    expect(response.body.checks.uploads.ok).toBe(true);
  });
});
