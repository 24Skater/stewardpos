import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/** The admin shell: who is signed in, sidebar navigation, theme toggle, logout. */

const getCurrentSession = vi.fn();
const logout = vi.fn();
vi.mock('@/lib/auth', () => ({
  getCurrentSession: () => getCurrentSession(),
  logout: () => logout(),
}));

const setTheme = vi.fn();
let theme = 'light';
vi.mock('next-themes', () => ({ useTheme: () => ({ theme, setTheme }) }));

const { default: AdminLayout } = await import('../AdminLayout');

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderLayout(path = '/admin') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <AdminLayout>
              <p>Page body</p>
              <Where />
            </AdminLayout>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  theme = 'light';
  getCurrentSession.mockResolvedValue({ user: { name: 'Pat Owner' } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminLayout', () => {
  it('shows a loading state until the session resolves, then the user and content', async () => {
    renderLayout();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(await screen.findByText('Pat Owner')).toBeInTheDocument();
    expect(screen.getByText('Page body')).toBeInTheDocument();
  });

  it('falls back to "User" when the session cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getCurrentSession.mockRejectedValue(new Error('expired'));

    renderLayout();

    expect(await screen.findByText('User')).toBeInTheDocument();
    expect(console.error).toHaveBeenCalled();
  });

  it('navigates in-app when a sidebar link or Back to POS is clicked', async () => {
    renderLayout();
    await screen.findByText('Pat Owner');

    fireEvent.click(screen.getByText('API Keys'));
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/api-keys');

    fireEvent.click(screen.getByText('Back to POS'));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('toggles from light to dark', async () => {
    renderLayout();

    fireEvent.click(await screen.findByRole('button', { name: /dark mode/i }));

    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('toggles from dark to light', async () => {
    theme = 'dark';
    renderLayout();

    fireEvent.click(await screen.findByRole('button', { name: /light mode/i }));

    expect(setTheme).toHaveBeenCalledWith('light');
  });

  it('logs out and goes to the login page', async () => {
    renderLayout();

    fireEvent.click(await screen.findByRole('button', { name: /logout/i }));

    expect(logout).toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/login');
  });
});
