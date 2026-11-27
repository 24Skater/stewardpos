import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * Store settings: what loads, what a save sends (terminal credentials are
 * write-only — blank means keep), payment-method toggles, terminal tools and the
 * database reset.
 */

const STORED = {
  taxRateDefault: 0.0825,
  storeName: 'Corner Store',
  storeEmail: 'hi@shop.test',
  storePhone: '555',
  timezone: 'UTC',
  config: {
    authMethods: { google: true },
    demoMode: true,
    terminalCredentialsConfigured: true,
    paymentMethods: {
      cash: { enabled: true },
      zelle: { enabled: true, destination: 'pay@shop.test' },
      card: { enabled: true, provider: 'stripe' },
    },
  },
};

const { adminApi, terminalApi } = vi.hoisted(() => ({
  adminApi: { settings: { get: vi.fn(), update: vi.fn() }, resetDatabase: vi.fn() },
  terminalApi: { test: vi.fn(), listReaders: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ adminApi, terminalApi }));

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn(), toasts: [] }),
}));
vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/settings/BrandingSettings', () => ({
  default: ({ onChange }: { onChange: (patch: Record<string, unknown>) => void }) => (
    <button onClick={() => onChange({ brandColor: '#123456' })}>Set brand colour</button>
  ),
}));

const { default: AdminSettings } = await import('../admin/AdminSettings');

let client: QueryClient;
function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminSettings />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const openTab = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });
const save = () => fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
const sentPayload = () => adminApi.settings.update.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  adminApi.settings.get.mockResolvedValue(STORED);
  adminApi.settings.update.mockResolvedValue(STORED);
  adminApi.resetDatabase.mockResolvedValue({});
  terminalApi.test.mockResolvedValue({ success: true, message: 'ok' });
  terminalApi.listReaders.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminSettings — general', () => {
  it('loads stored settings into the form', async () => {
    renderPage();

    expect(await screen.findByDisplayValue('Corner Store')).toBeInTheDocument();
    expect(screen.getByLabelText(/default tax rate/i)).toHaveValue(8.25);
    expect(screen.getByLabelText('Store Email')).toHaveValue('hi@shop.test');
  });

  it('falls back to defaults when settings cannot be loaded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    adminApi.settings.get.mockRejectedValue(new Error('Down'));

    renderPage();

    expect(await screen.findByLabelText('Store Name')).toHaveValue('');
    expect(screen.getByLabelText(/default tax rate/i)).toHaveValue(8);
    expect(console.warn).toHaveBeenCalled();
  });

  it('saves edits, sends blank terminal credentials as "keep", and refreshes the shared settings query', async () => {
    renderPage();
    await screen.findByDisplayValue('Corner Store');
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    fireEvent.change(screen.getByLabelText('Store Name'), { target: { value: 'Corner Shop' } });
    fireEvent.change(screen.getByLabelText('Store Email'), { target: { value: 'new@shop.test' } });
    fireEvent.change(screen.getByLabelText('Store Phone'), { target: { value: '556' } });
    fireEvent.change(screen.getByLabelText(/default tax rate/i), { target: { value: '7.5' } });
    save();

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: 'Settings saved successfully' }));
    expect(sentPayload()).toMatchObject({
      storeName: 'Corner Shop', storeEmail: 'new@shop.test', storePhone: '556', taxRateDefault: 0.075,
      config: { terminalCredentials: {}, demoMode: true, authMethods: { local: true, google: true, oidc: false } },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: expect.arrayContaining(['settings']) });
  });

  it('treats a cleared tax rate as zero', async () => {
    renderPage();
    await screen.findByDisplayValue('Corner Store');

    fireEvent.change(screen.getByLabelText(/default tax rate/i), { target: { value: '' } });
    save();

    await waitFor(() => expect(adminApi.settings.update).toHaveBeenCalled());
    expect(sentPayload().taxRateDefault).toBe(0);
  });

  it('reports a failed save', async () => {
    adminApi.settings.update.mockRejectedValue(new Error('Forbidden'));
    renderPage();
    await screen.findByDisplayValue('Corner Store');

    save();

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error saving settings', description: 'Forbidden' }))
    );
  });

  it('reports a non-Error save failure generically', async () => {
    adminApi.settings.update.mockRejectedValue('nope');
    renderPage();
    await screen.findByDisplayValue('Corner Store');

    save();

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Failed to save settings' }))
    );
  });

  it('merges a branding change into what is saved', async () => {
    renderPage();
    await screen.findByDisplayValue('Corner Store');

    openTab('Branding');
    fireEvent.click(await screen.findByRole('button', { name: 'Set brand colour' }));
    save();

    await waitFor(() => expect(adminApi.settings.update).toHaveBeenCalled());
    expect(sentPayload()).toMatchObject({ brandColor: '#123456', storeName: 'Corner Store' });
  });
});

describe('AdminSettings — payments', () => {
  it('toggles cash and zelle and edits the zelle destination', async () => {
    renderPage();
    await screen.findByDisplayValue('Corner Store');
    openTab('Payments');

    fireEvent.change(await screen.findByTestId('zelle-destination'), { target: { value: '555-0100' } });
    fireEvent.click(screen.getByTestId('cash-toggle'));
    save();
    await waitFor(() => expect(adminApi.settings.update).toHaveBeenCalled());
    expect(sentPayload().config.paymentMethods).toMatchObject({
      cash: { enabled: false },
      zelle: { enabled: true, destination: '555-0100' },
    });

    fireEvent.click(screen.getByTestId('zelle-toggle'));
    expect(screen.queryByTestId('zelle-destination')).not.toBeInTheDocument();
  });

  it('collects Stripe credentials as typed and says stored keys are never shown', async () => {
    renderPage();
    await screen.findByDisplayValue('Corner Store');
    openTab('Payments');

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByText(/stored keys are never shown/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Secret Key'), { target: { value: 'sk_live_new' } });
    fireEvent.change(screen.getByLabelText('Terminal Location ID'), { target: { value: 'tml_1' } });
    fireEvent.change(screen.getByLabelText('Reader ID'), { target: { value: 'tmr_1' } });
    save();

    await waitFor(() => expect(adminApi.settings.update).toHaveBeenCalled());
    expect(sentPayload().config.terminalCredentials).toEqual({
      stripeSecretKey: 'sk_live_new', stripeTerminalLocationId: 'tml_1', stripeReaderId: 'tmr_1',
    });
  });

  it.each([
    ['square', ['Access Token', 'Location ID', 'Device ID'], { squareAccessToken: 'v0', squareLocationId: 'v1', squareDeviceId: 'v2' }],
    ['clover', ['API Token', 'Merchant ID', 'Device ID'], { cloverApiToken: 'v0', cloverMerchantId: 'v1', cloverDeviceId: 'v2' }],
    ['verifone', ['API Key', 'Merchant ID', 'Terminal ID / IP'], { verifoneApiKey: 'v0', verifoneMerchantId: 'v1', verifoneTerminalId: 'v2' }],
    ['dejavoo', ['API Key', 'Merchant ID', 'Terminal ID'], { dejavooApiKey: 'v0', dejavooMerchantId: 'v1', dejavooTerminalId: 'v2' }],
  ])('collects %s credentials', async (provider, labels, expected) => {
    adminApi.settings.get.mockResolvedValue({
      ...STORED,
      config: { ...STORED.config, terminalCredentialsConfigured: false, paymentMethods: { ...STORED.config.paymentMethods, card: { enabled: true, provider } } },
    });
    renderPage();
    await screen.findByDisplayValue('Corner Store');
    openTab('Payments');

    await screen.findByLabelText(labels[0]);
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    labels.forEach((label, i) => fireEvent.change(screen.getByLabelText(label), { target: { value: `v${i}` } }));
    save();

    await waitFor(() => expect(adminApi.settings.update).toHaveBeenCalled());
    expect(sentPayload().config.terminalCredentials).toEqual(expected);
  });

  it('needs no credentials for the generic provider, and hides card options when card is off', async () => {
    adminApi.settings.get.mockResolvedValue({
      ...STORED,
      config: { ...STORED.config, paymentMethods: { ...STORED.config.paymentMethods, card: { enabled: true, provider: 'generic' } } },
    });
    renderPage();
    await screen.findByDisplayValue('Corner Store');
    openTab('Payments');

    expect(await screen.findByText(/no credentials required/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('card-toggle'));
    expect(screen.queryByTestId('card-provider-select')).not.toBeInTheDocument();
  });

  it('tests the terminal connection and reports either outcome', async () => {
    renderPage();
    await screen.findByDisplayValue('Corner Store');
    openTab('Payments');

    fireEvent.click(await screen.findByRole('button', { name: 'Test Connection' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Connection successful' })));

    terminalApi.test.mockRejectedValueOnce(new Error('Reader offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Connection test failed', description: 'Reader offline' }))
    );

    terminalApi.test.mockRejectedValueOnce('x');
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Error' })));
  });

  it('reports a failed reader discovery', async () => {
    terminalApi.listReaders.mockRejectedValueOnce(new Error('Bad key')).mockRejectedValueOnce('x');
    renderPage();
    await screen.findByDisplayValue('Corner Store');
    openTab('Payments');

    fireEvent.click(await screen.findByRole('button', { name: 'Discover Readers' }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Reader discovery failed', description: 'Bad key' }))
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discover Readers' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Error' })));
  });

  it('finds the readers the server actually returns (an unwrapped array)', async () => {
    terminalApi.listReaders.mockResolvedValue([{ id: 'tmr_9', label: 'Counter', status: 'online' }]);
    renderPage();
    await screen.findByDisplayValue('Corner Store');
    openTab('Payments');

    fireEvent.click(await screen.findByRole('button', { name: 'Discover Readers' }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: 'Found 1 reader(s)' }), { timeout: 500 });
  });
});

describe('AdminSettings — auth and database', () => {
  it('saves the authentication method switches', async () => {
    renderPage();
    await screen.findByDisplayValue('Corner Store');
    openTab('Authentication');

    const panel = await screen.findByRole('tabpanel');
    const [local, google, oidc] = within(panel).getAllByRole('switch');
    fireEvent.click(local);
    fireEvent.click(google);
    fireEvent.click(oidc);
    save();

    await waitFor(() => expect(adminApi.settings.update).toHaveBeenCalled());
    expect(sentPayload().config.authMethods).toEqual({ local: false, google: false, oidc: true });
  });

  it('toggles demo mode', async () => {
    renderPage();
    await screen.findByDisplayValue('Corner Store');
    openTab('Database');

    fireEvent.click(within(await screen.findByRole('tabpanel')).getByRole('switch'));
    save();

    await waitFor(() => expect(adminApi.settings.update).toHaveBeenCalled());
    expect(sentPayload().config.demoMode).toBe(false);
  });

  it('resets the database only after confirming, and reports the outcome', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    renderPage();
    await screen.findByDisplayValue('Corner Store');
    openTab('Database');
    const reset = await screen.findByRole('button', { name: /reset database/i });

    fireEvent.click(reset);
    expect(adminApi.resetDatabase).not.toHaveBeenCalled();

    fireEvent.click(reset);
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: 'Database reset successfully' }));

    adminApi.resetDatabase.mockRejectedValueOnce(new Error('Admins only'));
    fireEvent.click(screen.getByRole('button', { name: /reset database/i }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Admins only' })));
    expect(confirmSpy).toHaveBeenCalledTimes(3);
  });
});
