import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * SetupGuard sends an unconfigured install to `/setup`, never blocks the
 * public routes, and fails open when the status endpoint is unreachable.
 */

const status = vi.fn();
vi.mock('@/lib/api', () => ({ setupApi: { status: () => status() } }));

const { default: SetupGuard } = await import('../SetupGuard');

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SetupGuard>
        <Routes>
          <Route path="/setup" element={<p>Setup wizard</p>} />
          <Route path="/login" element={<p>Login page</p>} />
          <Route path="/pair" element={<p>Pair page</p>} />
          <Route path="/admin" element={<p>Admin page</p>} />
        </Routes>
      </SetupGuard>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SetupGuard', () => {
  it.each(['/setup', '/login', '/pair'])('renders %s immediately without checking setup status', (path) => {
    renderAt(path);

    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(status).not.toHaveBeenCalled();
  });

  it('shows a loading state while the status check is in flight', () => {
    status.mockReturnValue(new Promise(() => {}));

    renderAt('/admin');

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('Admin page')).not.toBeInTheDocument();
  });

  it('redirects to /setup when the server needs setup', async () => {
    status.mockResolvedValue({ needsSetup: true });

    renderAt('/admin');

    expect(await screen.findByText('Setup wizard')).toBeInTheDocument();
    expect(screen.queryByText('Admin page')).not.toBeInTheDocument();
  });

  it('renders the route once setup is confirmed complete', async () => {
    status.mockResolvedValue({ needsSetup: false });

    renderAt('/admin');

    expect(await screen.findByText('Admin page')).toBeInTheDocument();
  });

  it('allows access when the status response is empty', async () => {
    status.mockResolvedValue(null);

    renderAt('/admin');

    expect(await screen.findByText('Admin page')).toBeInTheDocument();
    expect(console.warn).toHaveBeenCalled();
  });

  it('fails open when the status endpoint errors', async () => {
    status.mockRejectedValue(new Error('network down'));

    renderAt('/admin');

    expect(await screen.findByText('Admin page')).toBeInTheDocument();
    await waitFor(() => expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/allowing access/), expect.any(Error)));
  });
});
