import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ApiClientError } from '@/lib/api-client';
import type { User } from '@/lib/api';

/**
 * Admin PIN management: set and clear an employee's register PIN.
 *
 * The two things that matter most here are things the UI must NOT do: it
 * must never render an existing PIN (the backend cannot return one — see
 * `SetPinRequest`'s doc comment in `lib/api/admin.ts`), and a rejected PIN
 * for being already in use must say so in plain language without naming who
 * else holds it.
 */

const USERS: User[] = [
  { id: 'u1', email: 'alex@shop.test', name: 'Alex Rivera', roleIds: [], status: 'active', createdAt: 1 },
  { id: 'u2', email: 'sam@shop.test', name: 'Sam Lee', roleIds: [], status: 'active', createdAt: 2 },
];

const listMock = vi.fn(async () => USERS);
const setPinMock = vi.fn(async (_id: string, _body: { pin: string }) => ({
  id: 'u1',
  email: 'alex@shop.test',
  name: 'Alex Rivera',
  status: 'active',
  pinSetAt: 1,
}));
const clearPinMock = vi.fn(async (_id: string) => ({
  id: 'u1',
  email: 'alex@shop.test',
  name: 'Alex Rivera',
  status: 'active',
  pinSetAt: null,
}));

vi.mock('@/lib/api', () => ({
  adminApi: {
    users: {
      list: () => listMock(),
      setPin: (id: string, body: { pin: string }) => setPinMock(id, body),
      clearPin: (id: string) => clearPinMock(id),
    },
  },
}));

const CashierPinManager = (await import('../CashierPinManager')).default;

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue(USERS);
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  confirmSpy.mockRestore();
});

describe('CashierPinManager', () => {
  it('lists staff with a Set PIN and Clear PIN action each', async () => {
    render(<CashierPinManager />);

    expect(await screen.findByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.getByText('Sam Lee')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /set pin/i })).toHaveLength(2);
  });

  it('never renders an existing PIN anywhere on the page', async () => {
    const { container } = render(<CashierPinManager />);

    await screen.findByText('Alex Rivera');

    // Nothing on the list view is, or claims to be, a PIN value - only a
    // set/clear action. No stray digit sequence claiming to be a PIN.
    expect(container.textContent).not.toMatch(/\bpin:?\s*\d{4,}/i);
  });

  describe('setting a PIN', () => {
    async function openDialogFor(name: string) {
      render(<CashierPinManager />);
      await screen.findByText(name);

      const row = screen.getByText(name).closest('tr') as HTMLElement;
      fireEvent.click(within(row).getByRole('button', { name: /set pin/i }));

      return screen.findByRole('dialog');
    }

    it('rejects a PIN with non-digit characters', async () => {
      const dialog = await openDialogFor('Alex Rivera');

      fireEvent.change(within(dialog).getByLabelText(/new pin/i), { target: { value: 'abc123' } });
      fireEvent.change(within(dialog).getByLabelText(/confirm pin/i), { target: { value: 'abc123' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /save pin/i }));

      // The input itself strips non-digits as they're typed, so what actually
      // gets validated is the empty string - either way, nothing is submitted.
      expect(setPinMock).not.toHaveBeenCalled();
    });

    it('rejects a PIN shorter than the floor', async () => {
      const dialog = await openDialogFor('Alex Rivera');

      fireEvent.change(within(dialog).getByLabelText(/new pin/i), { target: { value: '123' } });
      fireEvent.change(within(dialog).getByLabelText(/confirm pin/i), { target: { value: '123' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /save pin/i }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(/at least/i);
      expect(setPinMock).not.toHaveBeenCalled();
    });

    it('rejects mismatched PIN and confirmation', async () => {
      const dialog = await openDialogFor('Alex Rivera');

      fireEvent.change(within(dialog).getByLabelText(/new pin/i), { target: { value: '123456' } });
      fireEvent.change(within(dialog).getByLabelText(/confirm pin/i), { target: { value: '654321' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /save pin/i }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(/match/i);
      expect(setPinMock).not.toHaveBeenCalled();
    });

    it('sets the PIN for the right employee once valid and confirmed', async () => {
      const dialog = await openDialogFor('Alex Rivera');

      fireEvent.change(within(dialog).getByLabelText(/new pin/i), { target: { value: '123456' } });
      fireEvent.change(within(dialog).getByLabelText(/confirm pin/i), { target: { value: '123456' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /save pin/i }));

      await waitFor(() => expect(setPinMock).toHaveBeenCalledWith('u1', { pin: '123456' }));
    });

    it('surfaces an org-uniqueness conflict in plain language, without naming who holds it', async () => {
      setPinMock.mockRejectedValueOnce(new ApiClientError(409, 'That PIN is already in use'));
      const dialog = await openDialogFor('Alex Rivera');

      fireEvent.change(within(dialog).getByLabelText(/new pin/i), { target: { value: '123456' } });
      fireEvent.change(within(dialog).getByLabelText(/confirm pin/i), { target: { value: '123456' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /save pin/i }));

      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent(/already in use/i);
      // Never names the other employee - the whole point of not leaking
      // whose PIN it collided with.
      expect(alert).not.toHaveTextContent('Sam Lee');
    });

    it('never renders the raw PIN in a text field — the inputs are masked', async () => {
      const dialog = await openDialogFor('Alex Rivera');
      const pinInput = within(dialog).getByLabelText(/new pin/i);

      fireEvent.change(pinInput, { target: { value: '123456' } });

      expect(pinInput).toHaveAttribute('type', 'password');
    });
  });

  describe('clearing a PIN', () => {
    it('asks for confirmation before clearing', async () => {
      render(<CashierPinManager />);
      const row = (await screen.findByText('Alex Rivera')).closest('tr') as HTMLElement;

      fireEvent.click(within(row).getByRole('button', { name: /clear pin for alex rivera/i }));

      expect(confirmSpy).toHaveBeenCalled();
      await waitFor(() => expect(clearPinMock).toHaveBeenCalledWith('u1'));
    });

    it('does not clear when the confirmation is declined', async () => {
      confirmSpy.mockReturnValue(false);
      render(<CashierPinManager />);
      const row = (await screen.findByText('Alex Rivera')).closest('tr') as HTMLElement;

      fireEvent.click(within(row).getByRole('button', { name: /clear pin for alex rivera/i }));

      expect(clearPinMock).not.toHaveBeenCalled();
    });

    it('clears the right employee, not the whole roster', async () => {
      render(<CashierPinManager />);
      const row = (await screen.findByText('Sam Lee')).closest('tr') as HTMLElement;

      fireEvent.click(within(row).getByRole('button', { name: /clear pin for sam lee/i }));

      await waitFor(() => expect(clearPinMock).toHaveBeenCalledWith('u2'));
    });
  });
});
