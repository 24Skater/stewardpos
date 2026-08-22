import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { User } from '@/lib/api';

/**
 * A lockout exists to blunt PIN guessing, and a manager standing at the till
 * has already answered the question it was asking. What this guards is that the
 * screen offers the unlock only when there is something to unlock, and that it
 * re-reads the list afterwards rather than leaving a stale "locked" beside a
 * cashier who can now sign on.
 */

const { list, unlockPin } = vi.hoisted(() => ({ list: vi.fn(), unlockPin: vi.fn() }));

vi.mock('@/lib/api', () => ({
  adminApi: {
    users: {
      list: () => list(),
      setPin: vi.fn(),
      clearPin: vi.fn(),
      unlockPin: (id: string) => unlockPin(id),
    },
  },
}));

const { default: CashierPinManager } = await import('../CashierPinManager');

const base = { roleIds: [], status: 'active' as const, createdAt: 0, pinSetAt: 1000 };

const LOCKED: User = { ...base, id: 'u1', name: 'Locked Cashier', email: 'locked@demo.local', pinLockedUntil: Date.now() + 600_000 };
const UNLOCKED: User = { ...base, id: 'u2', name: 'Fine Cashier', email: 'fine@demo.local', pinLockedUntil: null };
const LAPSED: User = { ...base, id: 'u3', name: 'Waited It Out', email: 'waited@demo.local', pinLockedUntil: Date.now() - 1000 };

beforeEach(() => {
  vi.clearAllMocks();
  unlockPin.mockResolvedValue({ id: 'u1', pinSetAt: 1000, pinLockedUntil: null, pinFailedCount: 0 });
});

describe('CashierPinManager lockout', () => {
  it('says which cashier is locked out', async () => {
    list.mockResolvedValue([LOCKED, UNLOCKED]);
    render(<CashierPinManager />);

    expect(await screen.findByText(/locked after too many/i)).toBeInTheDocument();
  });

  it('clears the lockout on request', async () => {
    list.mockResolvedValue([LOCKED]);
    render(<CashierPinManager />);

    fireEvent.click(await screen.findByRole('button', { name: /unlock PIN for Locked Cashier/i }));

    await waitFor(() => expect(unlockPin).toHaveBeenCalledWith('u1'));
  });

  it('re-reads the list afterwards, so the row stops claiming a lockout', async () => {
    list.mockResolvedValueOnce([LOCKED]).mockResolvedValue([{ ...LOCKED, pinLockedUntil: null }]);
    render(<CashierPinManager />);

    fireEvent.click(await screen.findByRole('button', { name: /unlock PIN for Locked Cashier/i }));

    await waitFor(() => expect(screen.queryByText(/locked after too many/i)).not.toBeInTheDocument());
  });

  it('offers no unlock button when nothing is locked', async () => {
    list.mockResolvedValue([UNLOCKED]);
    render(<CashierPinManager />);

    await screen.findByText('Fine Cashier');
    expect(screen.queryByRole('button', { name: /unlock/i })).not.toBeInTheDocument();
  });

  it('treats a lockout that has already lapsed as no lockout', async () => {
    // The backend clears these lazily, so a past timestamp is the ordinary
    // resting state of someone who simply waited the fifteen minutes out.
    list.mockResolvedValue([LAPSED]);
    render(<CashierPinManager />);

    await screen.findByText('Waited It Out');
    expect(screen.queryByRole('button', { name: /unlock/i })).not.toBeInTheDocument();
  });
});
