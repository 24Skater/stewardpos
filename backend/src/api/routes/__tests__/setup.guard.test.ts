import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// The setup router pulls in config (which demands a 32-char JWT secret) and the real
// database service. Both are stubbed so the guard can be exercised in isolation.
const mockQuery = vi.fn();

vi.mock('../../../config', () => ({
  default: {
    database: { adapter: 'postgres' },
  },
}));

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({ pool: { query: mockQuery } }),
  },
}));

vi.mock('../../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../services/migrator', () => ({ Migrator: vi.fn() }));
vi.mock('../../../services/seeder', () => ({ Seeder: vi.fn() }));

const { rejectIfAlreadySetUp } = await import('../setup');

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: any };
}

/** Reply to the schema probe, then to the admin-count probe. */
function stubDb({ schemaExists, adminCount }: { schemaExists: boolean; adminCount: number }) {
  mockQuery.mockReset();
  mockQuery
    .mockResolvedValueOnce({ rows: [{ exists: schemaExists }] })
    .mockResolvedValueOnce({ rows: [{ count: String(adminCount) }] });
}

describe('rejectIfAlreadySetUp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks setup with 409 once an admin account exists', async () => {
    stubDb({ schemaExists: true, adminCount: 1 });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await rejectIfAlreadySetUp({} as Request, res, next);

    expect(res.statusCode).toBe(409);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows setup on a migrated database that has no admin yet', async () => {
    stubDb({ schemaExists: true, adminCount: 0 });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await rejectIfAlreadySetUp({} as Request, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it('allows setup on a genuine first run where the schema does not exist', async () => {
    stubDb({ schemaExists: false, adminCount: 0 });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await rejectIfAlreadySetUp({} as Request, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('allows setup when the database is unreachable', async () => {
    mockQuery.mockReset();
    mockQuery.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await rejectIfAlreadySetUp({} as Request, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });
});
