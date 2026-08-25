import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Which card reader a till drives.
 *
 * Merchant credentials are org-wide, because a secret key or access token
 * identifies the *account* and every register in a shop bills to the same one.
 * A device id identifies a *machine*, and three tills have three of them.
 *
 * Until now one global device id meant every register tried to drive the same
 * reader, so two lanes could not take a card at once — the single hard blocker
 * to physically running several registers.
 *
 * These tests assert the **resolution**: exactly what configuration the factory
 * is handed. Driving a real vendor SDK would test the vendor's HTTP client
 * rather than this decision, and would need live credentials to do it.
 */

const getUserByEmail = vi.fn();
const createTerminalTransaction = vi.fn();
const getTerminalTransactionByChargeId = vi.fn();
const updateTerminalTransactionByChargeId = vi.fn();
const getSettings = vi.fn();
const getRegisters = vi.fn();
const getRegisterById = vi.fn();
const createTerminalAdapter = vi.fn();
const getProductById = vi.fn();
const getOpenShiftForRegister = vi.fn();
const createPaymentAttempt = vi.fn();
const updatePaymentAttempt = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      createTerminalTransaction,
      getTerminalTransactionByChargeId,
      updateTerminalTransactionByChargeId,
      getSettings,
      getRegisters,
      getRegisterById,
      getProductById,
      getOpenShiftForRegister,
      createPaymentAttempt,
      updatePaymentAttempt,
    }),
  },
}));

vi.mock('../../../terminal/TerminalAdapterFactory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../terminal/TerminalAdapterFactory')>();
  return { ...actual, createTerminalAdapter };
});

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

const TILL_USER = {
  id: 'u1',
  email: 'admin@example.com',
  status: 'active',
  roleIds: ['r1'],
  roles: [
    {
      id: 'r1',
      name: 'Till',
      systemRole: 'standard',
      permissions: { orders: { read: true, write: true } },
    },
  ],
};

const REGISTER = {
  id: 'reg-1',
  orgId: '00000000-0000-0000-0000-000000000001',
  displayCode: 'MAIN-01',
  registerNumber: 1,
  status: 'active',
  hasCashDrawer: true,
  acceptsCash: true,
  canRefund: true,
  requireSignIn: false,
  canOpenDrawerNoSale: false,
  terminalProvider: null as string | null,
  terminalDeviceId: null as string | null,
};

const SQUARE_SETTINGS = {
  config: {
    paymentMethods: { card: { provider: 'square' } },
    terminalCredentials: {
      squareAccessToken: 'sq-token',
      squareLocationId: 'loc-1',
      squareDeviceId: 'STORE-WIDE-READER',
    },
  },
};

/** What the factory was actually asked to build. */
const builtWith = (): Record<string, unknown> =>
  createTerminalAdapter.mock.calls[0][0] as Record<string, unknown>;

/** A register with a reader of its own, bound to this till. */
function boundTo(overrides: Partial<typeof REGISTER>) {
  const register = { ...REGISTER, ...overrides };
  getRegisters.mockResolvedValue([register]);
  getRegisterById.mockResolvedValue(register);
  return register;
}

function primeDefaults() {
  getUserByEmail.mockResolvedValue(TILL_USER);
  getSettings.mockResolvedValue(SQUARE_SETTINGS);
  createTerminalTransaction.mockResolvedValue({ id: 't1' });
  updateTerminalTransactionByChargeId.mockResolvedValue(undefined);
  getRegisters.mockResolvedValue([REGISTER]);
  getRegisterById.mockResolvedValue(REGISTER);
  getProductById.mockResolvedValue({
    id: 'p1',
    name: 'Candle',
    basePrice: 12.5,
    variants: [{ id: 'v1', stock: 5, enabled: true }],
  });
  getOpenShiftForRegister.mockResolvedValue(null);
  createPaymentAttempt.mockImplementation(async (data) => ({ id: 'att-1', ...data }));
  updatePaymentAttempt.mockResolvedValue({});
  createTerminalAdapter.mockReturnValue({
    charge: vi.fn(async () => ({ chargeId: 'ch_1', status: 'pending' })),
    status: vi.fn(async () => ({ chargeId: 'ch_1', status: 'approved' })),
    cancel: vi.fn(async () => ({ chargeId: 'ch_1', status: 'cancelled' })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  primeDefaults();
});

// The cart is the input; the server prices it. What this file cares about is
// which reader and credentials the charge is routed through, not the figure.
const charge = () =>
  request(app)
    .post('/api/terminal/charge')
    .set(auth())
    .send({ items: [{ productId: 'p1', variantId: 'v1', quantity: 1 }] });

describe('per-register card reader binding', () => {
  it('uses the store reader when the register has no binding', async () => {
    // Every existing single-register install looks like this and must keep
    // working untouched — this is additive, not a migration.
    await charge();

    expect(builtWith()).toMatchObject({
      provider: 'square',
      squareDeviceId: 'STORE-WIDE-READER',
    });
  });

  it("prefers the register's own reader over the store-wide one", async () => {
    boundTo({ terminalDeviceId: 'LANE-2-READER' });

    await charge();

    expect(builtWith().squareDeviceId).toBe('LANE-2-READER');
  });

  it('keeps the org-wide credentials while overriding only the device', async () => {
    // The account is the store's; only the machine is the till's. Dropping the
    // credentials here would leave every bound register unable to authenticate.
    boundTo({ terminalDeviceId: 'LANE-2-READER' });

    await charge();

    expect(builtWith()).toMatchObject({
      squareAccessToken: 'sq-token',
      squareLocationId: 'loc-1',
      squareDeviceId: 'LANE-2-READER',
    });
  });

  it('lets a register speak a different provider from the store default', async () => {
    // A shop replacing readers one lane at a time runs mixed providers for a
    // while; refusing that would force a big-bang swap.
    boundTo({ terminalProvider: 'clover', terminalDeviceId: 'CLOVER-LANE-3' });

    await charge();

    expect(builtWith()).toMatchObject({
      provider: 'clover',
      cloverDeviceId: 'CLOVER-LANE-3',
    });
  });

  it('maps the device onto the field each provider actually reads', async () => {
    // One register column, four vendor spellings for the same idea.
    const cases: Array<[string, string]> = [
      ['stripe', 'stripeReaderId'],
      ['square', 'squareDeviceId'],
      ['clover', 'cloverDeviceId'],
      ['verifone', 'verifoneTerminalId'],
    ];

    for (const [provider, field] of cases) {
      vi.clearAllMocks();
      primeDefaults();
      boundTo({ terminalProvider: provider, terminalDeviceId: `DEV-${provider}` });

      await charge();

      expect(builtWith(), `${provider} should bind ${field}`).toMatchObject({
        provider,
        [field]: `DEV-${provider}`,
      });
    }
  });
});
