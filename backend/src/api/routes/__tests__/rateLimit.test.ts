import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

const getUserByEmail = vi.fn();
const updateUserLastLogin = vi.fn();

vi.mock('../../../services/database', () => ({
  default: { getAdapter: () => ({ getUserByEmail, updateUserLastLogin }) },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const PASSWORD = 'correct-horse-battery-staple';

async function activeUser() {
  return {
    id: 'u1',
    email: 'staff@example.com',
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    name: 'Staff',
    status: 'active',
    roleIds: [],
    roles: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateUserLastLogin.mockResolvedValue(undefined);
});

/**
 * The two runtime cases below share one bucket: supertest always presents the
 * same address, and the app does not trust forwarded headers by default (see
 * `trustProxy`), so `X-Forwarded-For` cannot separate them. The successful
 * sign-in case therefore has to run first, while the budget is untouched —
 * which is also the stronger assertion, since it shows successes really do not
 * consume it.
 */
describe('login rate limiting', () => {
  it('is configured far tighter than the global limit', () => {
    // The global budget is sized for a shop mid-rush, which makes it useless
    // against password guessing. The point of the login bucket is the gap.
    expect(config.rateLimit.maxLoginAttempts).toBeLessThan(config.rateLimit.maxRequests / 10);
  });

  it('does not spend the budget on successful sign-ins', async () => {
    // A shift change - several cashiers signing in one after another - must not
    // exhaust a limit meant for attackers.
    getUserByEmail.mockResolvedValue(await activeUser());

    for (let i = 0; i < config.rateLimit.maxLoginAttempts * 2; i++) {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'staff@example.com', password: PASSWORD });

      expect(response.status).toBe(200);
    }
  });

  it('blocks after repeated failures', async () => {
    getUserByEmail.mockResolvedValue(await activeUser());

    let blocked = 0;
    for (let i = 0; i <= config.rateLimit.maxLoginAttempts; i++) {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'staff@example.com', password: 'wrong-every-time' });

      if (response.status === 429) blocked++;
    }

    expect(blocked).toBeGreaterThan(0);
  });
});

describe('global rate limiting', () => {
  it('allows enough headroom for a store to trade', () => {
    // Measured against the running app: opening the register costs ~24 calls and
    // each sale adds ~3. The old limit of 100 allowed roughly 25 sales per
    // window for every terminal in the shop combined, since they share one
    // public IP.
    const openingTheRegister = 24;
    const perSale = 3;
    const salesPerWindow = (config.rateLimit.maxRequests - openingTheRegister) / perSale;

    expect(salesPerWindow).toBeGreaterThan(500);
  });
});

describe('trust proxy', () => {
  it('defaults to trusting nothing', () => {
    // Getting this wrong is dangerous in both directions. Too low behind a proxy
    // and every client shares one bucket; too high with nothing in front and any
    // client can spoof `X-Forwarded-For` to escape the limits altogether. The
    // safe default is to trust nothing and require the deployment to say.
    expect(config.trustProxy).toBe(0);
  });
});
