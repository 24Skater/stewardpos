import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * API key management: create (the secret is shown exactly once), revoke
 * (only after confirming), enable/disable, and the reference docs tab.
 */

const KEYS = [
  {
    id: 'k1', name: 'Shopify sync', description: 'Nightly stock push', keyPrefix: 'spk_ab12', scopes: ['read', 'write'],
    rateLimit: 1000, isActive: true, lastUsedAt: Date.UTC(2026, 0, 2), createdAt: 0,
  },
  { id: 'k2', name: 'Old kiosk', keyPrefix: 'spk_cd34', scopes: ['delete', 'admin', 'custom'], rateLimit: 50, isActive: false, createdAt: 0 },
];

const DOCS = {
  version: '1.0.0',
  baseUrl: '/api',
  authentication: { type: 'API key', header: 'X-API-Key', format: '<key>', example: 'X-API-Key: spk_example', note: 'Keys are per integration.' },
  scopes: { read: 'Read things', admin: 'Everything' },
  rateLimiting: {},
  errors: { '401': 'Missing or bad key' },
  endpoints: [
    { group: 'Products', routes: [
      { method: 'GET', path: '/api/products', scope: 'read' },
      { method: 'POST', path: '/api/products', scope: 'write' },
      { method: 'PUT', path: '/api/products/:id', scope: 'write' },
      { method: 'DELETE', path: '/api/products/:id', scope: 'delete' },
    ] },
  ],
  examples: {},
};

const api = {
  list: vi.fn(),
  reference: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
};
vi.mock('@/lib/api', () => ({ apiKeysApi: api }));

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn(), toasts: [] }),
}));
vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { default: AdminApiKeys } = await import('../admin/AdminApiKeys');

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminApiKeys />
    </MemoryRouter>
  );
}

const writeText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue(KEYS);
  api.reference.mockResolvedValue(DOCS);
  api.create.mockResolvedValue({ ...KEYS[0], id: 'k3', name: 'New one', scopes: ['read', 'admin'], key: 'spk_full_secret_value' });
  api.update.mockResolvedValue({});
  api.remove.mockResolvedValue({});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function rowFor(name: string) {
  return screen.getByText(name).closest('tr') as HTMLElement;
}

describe('AdminApiKeys', () => {
  it('lists keys with prefix, scopes, status and last use', async () => {
    renderPage();

    expect(await screen.findByText('Shopify sync')).toBeInTheDocument();
    expect(screen.getByText('spk_ab12...')).toBeInTheDocument();
    expect(screen.getByText('Nightly stock push')).toBeInTheDocument();
    expect(within(rowFor('Shopify sync')).getByText('Active')).toBeInTheDocument();
    expect(within(rowFor('Old kiosk')).getByText('Disabled')).toBeInTheDocument();
    expect(within(rowFor('Old kiosk')).getByText('Never')).toBeInTheDocument();
  });

  it('says so when there are no keys', async () => {
    api.list.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText(/no api keys yet/i)).toBeInTheDocument();
  });

  it('surfaces a failure to load keys', async () => {
    api.list.mockRejectedValue(new Error('Forbidden'));
    api.reference.mockRejectedValue(new Error('nope'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderPage();

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error', description: 'Forbidden' }))
    );
  });

  it('requires a name before creating a key', async () => {
    renderPage();
    await screen.findByText('Shopify sync');

    fireEvent.click(screen.getByRole('button', { name: /create api key/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create Key' }));

    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Name is required' }));
    expect(api.create).not.toHaveBeenCalled();
  });

  it('creates a key with the chosen scopes and shows the secret once', async () => {
    renderPage();
    await screen.findByText('Shopify sync');

    fireEvent.click(screen.getByRole('button', { name: /create api key/i }));
    fireEvent.change(await screen.findByLabelText(/name \*/i), { target: { value: 'New one' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'For the website' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Admin' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Write' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Write' }));
    fireEvent.change(screen.getByLabelText(/rate limit/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Key' }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({
        name: 'New one', description: 'For the website', scopes: ['read', 'admin'], rateLimit: 1000,
      })
    );

    const dialog = await screen.findByRole('dialog', { name: /api key created/i });
    expect(within(dialog).getByText(/only time you will see this key/i)).toBeInTheDocument();
    const secret = within(dialog).getByDisplayValue('spk_full_secret_value');
    // Masked until asked for.
    expect(secret).toHaveAttribute('type', 'password');
    const [reveal, copy] = within(dialog).getAllByRole('button').filter((b) => b.textContent === '');
    fireEvent.click(reveal);
    expect(secret).toHaveAttribute('type', 'text');
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith('spk_full_secret_value');
    expect(api.list).toHaveBeenCalledTimes(2);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByDisplayValue('spk_full_secret_value')).not.toBeInTheDocument());
  });

  it('surfaces a create failure and keeps the form open', async () => {
    api.create.mockRejectedValue(new Error('Name taken'));
    renderPage();
    await screen.findByText('Shopify sync');

    fireEvent.click(screen.getByRole('button', { name: /create api key/i }));
    fireEvent.change(await screen.findByLabelText(/name \*/i), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Key' }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Name taken' }))
    );
    expect(screen.getByRole('button', { name: 'Create Key' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Create Key' })).not.toBeInTheDocument());
  });

  function deleteButton(name: string) {
    const buttons = within(rowFor(name)).getAllByRole('button');
    return buttons[buttons.length - 1];
  }

  it('does not revoke a key when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await screen.findByText('Shopify sync');

    fireEvent.click(deleteButton('Shopify sync'));

    expect(window.confirm).toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('revokes a key after confirming and reloads the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await screen.findByText('Shopify sync');

    fireEvent.click(deleteButton('Shopify sync'));

    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('k1'));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: 'API key revoked' }));
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('surfaces a revoke failure', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.remove.mockRejectedValue(new Error('Gone'));
    renderPage();
    await screen.findByText('Shopify sync');

    fireEvent.click(deleteButton('Shopify sync'));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Gone' })));
  });

  it('disables an active key and enables a disabled one', async () => {
    renderPage();
    await screen.findByText('Shopify sync');

    fireEvent.click(within(rowFor('Shopify sync')).getByTitle('Disable'));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('k1', { isActive: false }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: 'API key disabled' }));

    fireEvent.click(within(rowFor('Old kiosk')).getByTitle('Enable'));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('k2', { isActive: true }));
  });

  it('surfaces a toggle failure', async () => {
    api.update.mockRejectedValue(new Error('Locked'));
    renderPage();
    await screen.findByText('Shopify sync');

    fireEvent.click(within(rowFor('Shopify sync')).getByTitle('Disable'));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Locked' })));
  });

  it('documents the X-API-Key header and endpoints from the server reference', async () => {
    renderPage();
    await screen.findByText('Shopify sync');

    const docsTab = screen.getByRole('tab', { name: /api documentation/i });
    fireEvent.mouseDown(docsTab, { button: 0 });

    expect(await screen.findByText('X-API-Key: spk_example')).toBeInTheDocument();
    expect(screen.getByText('Keys are per integration.')).toBeInTheDocument();
    expect(screen.getByText('Missing or bad key')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Products' }));
    expect(await screen.findByText('DELETE')).toBeInTheDocument();
    expect(screen.getByText('PUT')).toBeInTheDocument();
  });
});
