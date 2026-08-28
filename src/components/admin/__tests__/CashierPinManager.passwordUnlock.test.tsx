import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { User } from '@/lib/api';

/**
 * The password lockout's unlock, alongside the PIN one.
 *
 * Every account lockout is also a denial-of-service primitive — anyone who
 * knows an address can hold that account shut by failing on purpose — so the
 * screen that can clear it is not a convenience. Without it the only recovery
 * is waiting out an attacker's timer.
 *
 * The two lockouts are separate state on the same row, which is the thing most
 * likely to be got wrong here: a cashier can be locked out of the till with a
 * perfectly good password, and an admin locked out of the back office still has
 * a working PIN. These assert the screen keeps them apart.
 */

const { list, unlockPin, unlockPassword } = vi.hoisted(() => ({
  list: vi.fn(),
  unlockPin: vi.fn(),
  unlockPassword: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  adminApi: {
    users: {
      list: () => list(),
      setPin: vi.fn(),
      clearPin: vi.fn(),
      unlockPin: (id: string) => unlockPin(id),
      unlockPassword: (id: string) => unlockPassword(id),
    },
  },
}));

const { default: CashierPinManager } = await import('../CashierPinManager');

const base = { roleIds: [], status: 'active' as const, createdAt: 0, pinSetAt: 1000 };

const PASSWORD_LOCKED: User = {
  ...base,
  id: 'u1',
  name: 'Locked Manager',
  email: 'manager@demo.local',
  pinLockedUntil: null,
  passwordLockedUntil: Date.now() + 600_000,
};

const PIN_LOCKED: User = {
  ...base,
  id: 'u2',
  name: 'Locked Cashier',
  email: 'cashier@demo.local',
  pinLockedUntil: Date.now() + 600_000,
  passwordLockedUntil: null,
};

const LAPSED: User = {
  ...base,
  id: 'u3',
  name: 'Waited It Out',
  email: 'waited@demo.local',
  pinLockedUntil: null,
  passwordLockedUntil: Date.now() - 1000,
};

beforeEach(() => {
  vi.clearAllMocks();
  unlockPassword.mockResolvedValue({ id: 'u1', passwordLockedUntil: null, passwordFailedCount: 0 });
});

describe('CashierPinManager password lockout', () => {
  it('says who is locked out of sign-in', async () => {
    list.mockResolvedValue([PASSWORD_LOCKED]);
    render(<CashierPinManager />);

    expect(await screen.findByText(/sign-in locked after too many/i)).toBeInTheDocument();
  });

  it('clears the lockout on request', async () => {
    list.mockResolvedValue([PASSWORD_LOCKED]);
    render(<CashierPinManager />);

    fireEvent.click(await screen.findByRole('button', { name: /unlock sign-in for Locked Manager/i }));

    await waitFor(() => expect(unlockPassword).toHaveBeenCalledWith('u1'));
  });

  it('re-reads the list afterwards rather than patching the row', async () => {
    // The lockout is server state. A local edit would quietly disagree with it
    // the moment anything else changed it.
    list
      .mockResolvedValueOnce([PASSWORD_LOCKED])
      .mockResolvedValue([{ ...PASSWORD_LOCKED, passwordLockedUntil: null }]);
    render(<CashierPinManager />);

    fireEvent.click(await screen.findByRole('button', { name: /unlock sign-in for Locked Manager/i }));

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText(/sign-in locked after too many/i)).not.toBeInTheDocument()
    );
  });

  it('offers nothing for a lockout that has already lapsed', async () => {
    // The backend clears these lazily, so a past timestamp is the ordinary
    // resting state of somebody who waited. Offering to unlock it would be
    // offering to do nothing.
    list.mockResolvedValue([LAPSED]);
    render(<CashierPinManager />);

    expect(await screen.findByText('Waited It Out')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unlock sign-in/i })).not.toBeInTheDocument();
  });

  it('does not confuse a PIN lockout for a sign-in lockout', async () => {
    list.mockResolvedValue([PIN_LOCKED]);
    render(<CashierPinManager />);

    expect(await screen.findByRole('button', { name: /unlock PIN for Locked Cashier/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unlock sign-in/i })).not.toBeInTheDocument();
  });

  it('unlocks only the credential asked for', async () => {
    // Both locked at once: clearing one must not clear the other, since they
    // are answers to different questions.
    list.mockResolvedValue([
      { ...PASSWORD_LOCKED, pinLockedUntil: Date.now() + 600_000 },
    ]);
    render(<CashierPinManager />);

    fireEvent.click(await screen.findByRole('button', { name: /unlock sign-in for Locked Manager/i }));

    await waitFor(() => expect(unlockPassword).toHaveBeenCalledWith('u1'));
    expect(unlockPin).not.toHaveBeenCalled();
  });
});
