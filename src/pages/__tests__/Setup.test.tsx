import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * The first-run wizard: six steps, a database step that disappears when there
 * is nothing to configure, and client-side validation that has to stop a bad
 * submission before it reaches `POST /api/setup/complete`.
 */

const status = vi.fn();
const testDatabase = vi.fn();
const complete = vi.fn();

vi.mock('@/lib/api', () => ({
  setupApi: {
    status: (...args: unknown[]) => status(...args),
    testDatabase: (...args: unknown[]) => testDatabase(...args),
    complete: (...args: unknown[]) => complete(...args),
  },
}));

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn(), toasts: [] }),
}));

const { default: Setup } = await import('../Setup');

const NEEDS_SETUP = { isInitialized: false, hasAdminUser: false, needsSetup: true, databaseAdapter: 'postgres' };
const GOOD_PASSWORD = 'Tr0ub4dor&3-horse';

function renderSetup() {
  return render(
    <MemoryRouter initialEntries={['/setup']}>
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const type = (placeholder: string, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

/** Wait for the status check, then walk from step 1 to step 3 in production mode. */
async function reachAdminStep() {
  await waitFor(() => expect(status).toHaveBeenCalled());
  click('Continue');
  click('Continue');
  await screen.findByText('Create Admin Account');
}

function fillAdmin(overrides: Partial<Record<'name' | 'email' | 'password' | 'confirm', string>> = {}) {
  const { name = 'Pat Owner', email = 'pat@shop.test', password = GOOD_PASSWORD, confirm = password } = overrides;
  type('John Doe', name);
  type('admin@yourcompany.com', email);
  const [pw, confirmPw] = screen.getAllByPlaceholderText('••••••••');
  fireEvent.change(pw, { target: { value: password } });
  fireEvent.change(confirmPw, { target: { value: confirm } });
}

/** From step 3, through auth and environment, to the review step. */
function advanceToReview() {
  click('Continue');
  click('Continue');
  click('Continue');
  expect(screen.getByText('Review Configuration')).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  status.mockResolvedValue(NEEDS_SETUP);
  testDatabase.mockResolvedValue({ ok: true });
  complete.mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Setup wizard', () => {
  it('redirects to login when the server reports setup is already done', async () => {
    status.mockResolvedValue({ ...NEEDS_SETUP, needsSetup: false, isInitialized: true, hasAdminUser: true });

    renderSetup();

    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('stays on the wizard when the status check fails', async () => {
    status.mockRejectedValue(new Error('404'));

    renderSetup();

    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
  });

  it('shows the database form in production mode and tests the connection', async () => {
    renderSetup();
    await waitFor(() => expect(status).toHaveBeenCalled());

    click('Continue');
    expect(screen.getByText('Database Configuration')).toBeInTheDocument();
    type('localhost or database server IP', 'db.internal');
    fireEvent.change(screen.getByPlaceholderText('5432'), { target: { value: 'abc' } });
    type('stewardpos', 'pos');
    type('postgres', 'pos_user');
    click(/test connection/i);

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }))
    );
    // A non-numeric port falls back to the default rather than NaN.
    expect(testDatabase).toHaveBeenCalledWith(
      expect.objectContaining({ adapter: 'postgres', host: 'db.internal', port: 5432, name: 'pos', user: 'pos_user' })
    );
  });

  it('reports a failed connection test with the server message', async () => {
    testDatabase.mockRejectedValue(new Error('ECONNREFUSED'));
    renderSetup();
    await waitFor(() => expect(status).toHaveBeenCalled());

    click('Continue');
    click(/test connection/i);

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Connection Failed', description: 'ECONNREFUSED', variant: 'destructive' })
      )
    );
  });

  it('skips the database form in demo mode and says why', async () => {
    renderSetup();
    await waitFor(() => expect(status).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Demo Mode'));
    expect(screen.getByText(/load sample data. You'll still need/)).toBeInTheDocument();
    click('Continue');

    expect(screen.queryByText('Database Configuration')).not.toBeInTheDocument();
    expect(screen.getByText(/Demo mode will use the existing database configuration and load sample data. You still/)).toBeInTheDocument();

    click('Continue');
    // Back from the admin step returns to step 1, not the skipped step 2.
    click('Back');
    expect(screen.getByText('Choose Setup Mode')).toBeInTheDocument();
  });

  it('skips the database form when the server already has a migrated database', async () => {
    status.mockResolvedValue({ ...NEEDS_SETUP, isInitialized: true, databaseAdapter: 'sqlite' });
    renderSetup();
    await waitFor(() => expect(status).toHaveBeenCalled());

    click('Continue');

    expect(await screen.findByText(/already connected to a SQLite database/)).toBeInTheDocument();
  });

  it('refuses to submit with missing admin fields', async () => {
    renderSetup();
    await reachAdminStep();
    advanceToReview();

    click(/complete setup/i);

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Please fill in all admin user fields' })
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('refuses to submit when the passwords differ', async () => {
    renderSetup();
    await reachAdminStep();
    fillAdmin({ confirm: 'something-else-entirely' });
    advanceToReview();

    click(/complete setup/i);

    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Passwords do not match' }));
    expect(complete).not.toHaveBeenCalled();
  });

  it('refuses a password the server policy would reject', async () => {
    renderSetup();
    await reachAdminStep();
    fillAdmin({ password: 'short' });
    advanceToReview();

    click(/complete setup/i);

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Validation Error', description: expect.stringMatching(/12/) })
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('requires PostgreSQL connection details when configuring a new database', async () => {
    renderSetup();
    await reachAdminStep();
    fillAdmin();
    advanceToReview();

    click(/complete setup/i);

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Please fill in all PostgreSQL connection details' })
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('submits the full configuration and redirects to login after a pause', async () => {
    renderSetup();
    await waitFor(() => expect(status).toHaveBeenCalled());
    click('Continue');
    type('localhost or database server IP', 'db.internal');
    type('stewardpos', 'pos');
    type('postgres', 'pos_user');
    click('Continue');
    fillAdmin();
    click('Continue');
    // Auth step: add Google and OIDC, fill their fields, then drop local.
    fireEvent.click(screen.getByLabelText(/google oauth/i));
    fireEvent.click(screen.getByLabelText(/oidc\/saml/i));
    type('your-google-client-id', 'g-id');
    type('your-oidc-client-id', 'o-id');
    type('https://your-identity-provider.com', 'https://idp.test');
    const secrets = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(secrets[0], { target: { value: 'g-secret' } });
    fireEvent.change(secrets[1], { target: { value: 'o-secret' } });
    fireEvent.click(screen.getByLabelText(/local authentication/i));
    click('Continue');
    fireEvent.click(screen.getByLabelText(/enable data replication/i));
    expect(screen.getByText(/replication will be configured after setup/i)).toBeInTheDocument();
    click('Continue');

    expect(screen.getByText('google, oidc')).toBeInTheDocument();
    expect(screen.getByText('dev → prod')).toBeInTheDocument();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    click(/complete setup/i);

    await waitFor(() => expect(complete).toHaveBeenCalled());
    expect(complete).toHaveBeenCalledWith({
      adminUser: { name: 'Pat Owner', email: 'pat@shop.test', password: GOOD_PASSWORD },
      database: expect.objectContaining({ adapter: 'postgres', host: 'db.internal', name: 'pos', user: 'pos_user' }),
      auth: {
        methods: ['google', 'oidc'],
        google: { clientId: 'g-id', clientSecret: 'g-secret' },
        oidc: { issuer: 'https://idp.test', clientId: 'o-id', clientSecret: 'o-secret' },
      },
      environment: 'production',
      demoMode: false,
      replication: { enabled: true, source: 'dev', target: 'prod' },
    });
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Setup Complete!' }))
    );
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('sends only the adapter in demo mode and surfaces a server failure', async () => {
    complete.mockRejectedValue(new Error('Admin already exists'));
    renderSetup();
    await waitFor(() => expect(status).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Demo Mode'));
    click('Continue');
    click('Continue');
    fillAdmin();
    advanceToReview();
    expect(screen.queryByText('Database', { selector: 'h3, div' })).not.toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();

    click(/complete setup/i);

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Setup Failed', description: 'Admin already exists' })
      )
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ database: { adapter: 'postgres' }, demoMode: true, replication: undefined })
    );
  });

  it('walks back through every step', async () => {
    renderSetup();
    await reachAdminStep();
    advanceToReview();

    click('Back');
    expect(screen.getByText('Environment & Advanced Options')).toBeInTheDocument();
    click('Back');
    expect(screen.getByText('Authentication Configuration')).toBeInTheDocument();
    click('Back');
    expect(screen.getByText('Create Admin Account')).toBeInTheDocument();
    click('Back');
    expect(screen.getByText('Database Configuration')).toBeInTheDocument();
    click('Back');
    expect(screen.getByText('Choose Setup Mode')).toBeInTheDocument();
  });
});
