import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RegisterOverride } from '@/lib/api';

/**
 * The override log is the record that makes an override defensible after the
 * fact, so the two things it must never do are hide who was involved and hide
 * grants that went unused.
 */

const useRegisterOverrides = vi.fn();
const useRegisters = vi.fn();

vi.mock('@/hooks/queries', () => ({
  useRegisterOverrides: (...args: unknown[]) => useRegisterOverrides(...args),
  useRegisters: (...args: unknown[]) => useRegisters(...args),
}));

vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ProtectedRoute', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const AdminOverrides = (await import('../admin/AdminOverrides')).default;

function row(over: Partial<RegisterOverride> = {}): RegisterOverride {
  return {
    id: 'ov-1',
    registerId: 'reg-1',
    shiftId: 'sh-1',
    approverUserId: 'mgr-1',
    requestedByUserId: 'cash-1',
    action: 'discount_approval',
    grantPrefix: 'ovr_abcd',
    expiresAt: Date.now() - 1_000,
    consumedAt: Date.now() - 2_000,
    entity: 'discount',
    entityId: 'd-1',
    beforeValue: '20',
    afterValue: '40',
    reason: null,
    createdAt: Date.now() - 5_000,
    approverName: 'Bailey Boss',
    requestedByName: 'Casey Cashier',
    registerDisplayCode: 'MAIN-01',
    ...over,
  };
}

function renderPage(rows: RegisterOverride[]) {
  useRegisterOverrides.mockReturnValue({ data: { data: rows }, isLoading: false });
  useRegisters.mockReturnValue({ data: [{ id: 'reg-1', displayCode: 'MAIN-01', name: 'Front' }] });
  return render(
    <MemoryRouter>
      <AdminOverrides />
    </MemoryRouter>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('AdminOverrides', () => {
  it('names both people involved, not their ids', async () => {
    renderPage([row()]);

    expect(await screen.findByText('Bailey Boss')).toBeInTheDocument();
    expect(screen.getByText('Casey Cashier')).toBeInTheDocument();
    // The whole point of the view is answering "who", so a raw id leaking
    // through means the join was dropped.
    expect(screen.queryByText('mgr-1')).not.toBeInTheDocument();
  });

  it('shows what was authorised in plain language', async () => {
    renderPage([row()]);

    expect(await screen.findByText('Discount approval')).toBeInTheDocument();
    expect(screen.getByText('MAIN-01')).toBeInTheDocument();
  });

  it('distinguishes a used grant from one that was never used', async () => {
    renderPage([
      row({ id: 'ov-used', consumedAt: Date.now() - 100 }),
      row({ id: 'ov-lapsed', consumedAt: null, expiresAt: Date.now() - 100 }),
    ]);

    // A supervisor called over repeatedly and declining is a pattern worth
    // seeing; hiding unconsumed rows would describe only the approvals that
    // succeeded.
    expect(await screen.findByText('Used')).toBeInTheDocument();
    expect(screen.getByText('Never used')).toBeInTheDocument();
  });

  it('conveys status as text, not colour alone', async () => {
    renderPage([row({ consumedAt: null, expiresAt: Date.now() + 60_000 })]);

    expect(await screen.findByText('Awaiting use')).toBeInTheDocument();
  });

  it('says so plainly when nothing has been overridden', async () => {
    renderPage([]);

    expect(await screen.findByText(/no overrides have been granted/i)).toBeInTheDocument();
  });
});
