import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiClientError } from '@/lib/api-client';

/**
 * `PairRegister` is the standalone, session-free screen a device uses to
 * redeem a pairing code for a device token (`POST /api/registers/pair`).
 * These tests cover the frontend's own responsibility: normalising what the
 * operator typed, storing the token on success, and turning each of the
 * backend's distinct failure outcomes into its own plain-language message
 * rather than a single generic "invalid code".
 */

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const pairMock = vi.fn();
vi.mock('@/lib/api', () => ({
  registersApi: { pair: (...args: unknown[]) => pairMock(...args) },
}));

async function renderPairRegister() {
  const { default: PairRegister } = await import('../PairRegister');
  return render(
    <MemoryRouter>
      <PairRegister />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('PairRegister', () => {
  it('has a real label associated with the pairing code input', async () => {
    await renderPairRegister();

    expect(screen.getByLabelText(/pairing code/i)).toBeInTheDocument();
  });

  it('stores the token and the register id, then shows which register was paired', async () => {
    pairMock.mockResolvedValueOnce({
      token: 'srt_abcd1234_secret',
      register: { id: 'reg-1', displayCode: 'MAIN-01', name: 'Front Counter' },
    });
    await renderPairRegister();

    fireEvent.change(screen.getByLabelText(/pairing code/i), { target: { value: 'abcd-2345' } });
    fireEvent.click(screen.getByRole('button', { name: /pair register/i }));

    await waitFor(() => expect(screen.getByText(/register paired/i)).toBeInTheDocument());

    expect(screen.getByText(/MAIN-01/)).toBeInTheDocument();
    expect(screen.getByText(/Front Counter/)).toBeInTheDocument();

    const { getDeviceToken, getSelectedRegisterId } = await import('@/lib/register-device');
    expect(getDeviceToken()).toBe('srt_abcd1234_secret');
    expect(getSelectedRegisterId()).toBe('reg-1');

    // The token itself is never rendered back to the screen.
    expect(screen.queryByText('srt_abcd1234_secret')).not.toBeInTheDocument();
  });

  it('accepts the code without the separator and in lowercase, sending it normalised', async () => {
    pairMock.mockResolvedValueOnce({
      token: 'srt_abcd1234_secret',
      register: { id: 'reg-1', displayCode: 'MAIN-01', name: 'Front Counter' },
    });
    await renderPairRegister();

    fireEvent.change(screen.getByLabelText(/pairing code/i), { target: { value: 'abcd2345' } });
    fireEvent.click(screen.getByRole('button', { name: /pair register/i }));

    await waitFor(() => expect(pairMock).toHaveBeenCalledWith('ABCD2345'));
  });

  it('lets the operator continue to the POS after pairing', async () => {
    pairMock.mockResolvedValueOnce({
      token: 'srt_abcd1234_secret',
      register: { id: 'reg-1', displayCode: 'MAIN-01', name: 'Front Counter' },
    });
    await renderPairRegister();

    fireEvent.change(screen.getByLabelText(/pairing code/i), { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByRole('button', { name: /pair register/i }));
    await waitFor(() => expect(screen.getByText(/register paired/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /continue to pos/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/pos', { replace: true });
  });

  it('rejects a code shorter than 8 characters before ever calling the backend', async () => {
    await renderPairRegister();

    fireEvent.change(screen.getByLabelText(/pairing code/i), { target: { value: 'ABCD' } });
    fireEvent.click(screen.getByRole('button', { name: /pair register/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/full 8-character pairing code/i);
    expect(pairMock).not.toHaveBeenCalled();
  });

  it('tells the operator a code is unknown, not just "invalid"', async () => {
    pairMock.mockRejectedValueOnce(new ApiClientError(401, 'That pairing code is not valid'));
    await renderPairRegister();

    fireEvent.change(screen.getByLabelText(/pairing code/i), { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByRole('button', { name: /pair register/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn't match any pairing request/i);
  });

  it('tells the operator a code has expired, distinctly from an unknown code', async () => {
    pairMock.mockRejectedValueOnce(new ApiClientError(401, 'That pairing code has expired'));
    await renderPairRegister();

    fireEvent.change(screen.getByLabelText(/pairing code/i), { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByRole('button', { name: /pair register/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/i);
  });

  it('tells the operator a code was already redeemed', async () => {
    pairMock.mockRejectedValueOnce(new ApiClientError(401, 'That pairing code has already been used'));
    await renderPairRegister();

    fireEvent.change(screen.getByLabelText(/pairing code/i), { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByRole('button', { name: /pair register/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already been used/i);
  });

  it('tells the operator the register was retired', async () => {
    pairMock.mockRejectedValueOnce(new ApiClientError(422, 'That register has been retired'));
    await renderPairRegister();

    fireEvent.change(screen.getByLabelText(/pairing code/i), { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByRole('button', { name: /pair register/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/retired/i);
  });
});
