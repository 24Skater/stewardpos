import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthSession } from '@/lib/auth';

/**
 * The single gate in front of every admin route.
 *
 * There used to be two. `App.tsx` gated each route on a permission, and then
 * every admin page wrapped itself in a second, role-based guard. For seventeen
 * pages that was merely redundant; for API keys the two disagreed, and the
 * disagreement locked out exactly the role that had been granted the page.
 */

const getCurrentSession = vi.fn();

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getCurrentSession };
});

const { default: RequireAuth } = await import('../RequireAuth');

function session(overrides: {
  systemRole?: string;
  permissions?: Record<string, unknown>;
}): AuthSession {
  const { systemRole = 'standard', permissions = {} } = overrides;
  return {
    user: {
      id: 'u1',
      email: 'someone@example.com',
      name: 'Someone',
      roleIds: ['r1'],
      roles: [{ id: 'r1', name: 'Role', systemRole, permissions: permissions as never }],
    },
    permissions: permissions as never,
  };
}

function renderGuard(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/api-keys']}>
        <Routes>
          <Route path="/admin/api-keys" element={element} />
          <Route path="/login" element={<p>Sign in</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireAdmin', () => {
  it('admits an administrator', async () => {
    getCurrentSession.mockResolvedValue(session({ systemRole: 'admin' }));

    renderGuard(
      <RequireAuth requireAdmin>
        <p>Key management</p>
      </RequireAuth>
    );

    expect(await screen.findByText('Key management')).toBeInTheDocument();
  });

  /**
   * The defect this prop exists to fix.
   *
   * The route asked for `settings:write` while the page asked for the admin
   * role, so this user cleared the route, rendered the whole page, and was then
   * redirected to `/` by the inner guard with no explanation — the API Keys
   * screen was unreachable for precisely the role someone had granted it to.
   * The server has always required the role (`authorize(['admin'])` on the
   * whole router), so the gate has to say the same thing.
   */
  it('refuses settings:write without the admin role, and says why', async () => {
    getCurrentSession.mockResolvedValue(
      session({ permissions: { settings: { read: true, write: true } } })
    );

    renderGuard(
      <RequireAuth requireAdmin>
        <p>Key management</p>
      </RequireAuth>
    );

    expect(await screen.findByText(/limited to administrators/i)).toBeInTheDocument();
    expect(screen.queryByText('Key management')).not.toBeInTheDocument();
  });

  it('refuses rather than redirecting, so the user knows what happened', async () => {
    getCurrentSession.mockResolvedValue(session({}));

    renderGuard(
      <RequireAuth requireAdmin>
        <p>Key management</p>
      </RequireAuth>
    );

    await screen.findByText(/don't have access/i);
    // The old guard called navigate('/') here, which dropped the user on the
    // register with no idea why.
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  });
});

describe('permission', () => {
  it('admits a holder of the permission', async () => {
    getCurrentSession.mockResolvedValue(
      session({ permissions: { registers: { read: true } } })
    );

    renderGuard(
      <RequireAuth permission={{ domain: 'registers', action: 'read' }}>
        <p>Registers</p>
      </RequireAuth>
    );

    expect(await screen.findByText('Registers')).toBeInTheDocument();
  });

  it('names the permission it wanted', async () => {
    getCurrentSession.mockResolvedValue(session({}));

    renderGuard(
      <RequireAuth permission={{ domain: 'registers', action: 'read' }}>
        <p>Registers</p>
      </RequireAuth>
    );

    expect(await screen.findByText(/cannot read registers/i)).toBeInTheDocument();
  });

  it('admits an admin regardless, matching the server', async () => {
    getCurrentSession.mockResolvedValue(session({ systemRole: 'admin' }));

    renderGuard(
      <RequireAuth permission={{ domain: 'registers', action: 'delete' }}>
        <p>Registers</p>
      </RequireAuth>
    );

    expect(await screen.findByText('Registers')).toBeInTheDocument();
  });
});

describe('signed out', () => {
  it('sends the user to login with somewhere to come back to', async () => {
    getCurrentSession.mockResolvedValue(null);

    renderGuard(
      <RequireAuth requireAdmin>
        <p>Key management</p>
      </RequireAuth>
    );

    await waitFor(() => expect(screen.getByText('Sign in')).toBeInTheDocument());
  });
});
