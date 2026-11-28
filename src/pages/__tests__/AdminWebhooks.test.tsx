import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

/** Webhook screen: the signing secret is shown once, on create and rotate, then gone. */

const SUB = { id: 's1', url: 'https://hooks.example.test/in', events: ['order.created'], active: true, createdAt: 0, rotating: false };

const api = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  rotateSecret: vi.fn(),
  deliveries: vi.fn(),
  redeliver: vi.fn(),
};
vi.mock('@/lib/api', () => ({ webhooksApi: api }));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast, dismiss: vi.fn(), toasts: [] }),
}));
vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { default: AdminWebhooks } = await import('../admin/AdminWebhooks');

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue([SUB]);
  api.deliveries.mockResolvedValue([]);
  api.create.mockResolvedValue({ ...SUB, secret: 'whsec_created_once' });
  api.rotateSecret.mockResolvedValue({ ...SUB, rotating: true, secret: 'whsec_rotated_once' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminWebhooks />
    </MemoryRouter>
  );
}

describe('AdminWebhooks', () => {
  it('shows the secret once after create, and not after it is dismissed', async () => {
    renderPage();
    await screen.findByText(SUB.url);

    fireEvent.click(screen.getByText('Add webhook'));
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://new.example.test/h' } });
    fireEvent.click(screen.getByText('Create'));

    const field = (await screen.findByLabelText('Secret value')) as HTMLInputElement;
    expect(field.value).toBe('whsec_created_once');
    expect(api.create).toHaveBeenCalledWith({ url: 'https://new.example.test/h', events: ['order.created'] });

    fireEvent.click(screen.getByText('Done'));
    await waitFor(() => expect(screen.queryByLabelText('Secret value')).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue('whsec_created_once')).not.toBeInTheDocument();
  });

  it('shows the new secret after a rotation', async () => {
    renderPage();
    await screen.findByText(SUB.url);

    fireEvent.click(screen.getByLabelText(`Rotate secret for ${SUB.url}`));

    const field = (await screen.findByLabelText('Secret value')) as HTMLInputElement;
    expect(field.value).toBe('whsec_rotated_once');
  });

  it('disables an active webhook', async () => {
    api.update.mockResolvedValue({ ...SUB, active: false });
    renderPage();
    await screen.findByText(SUB.url);

    fireEvent.click(screen.getByText('Disable'));

    await waitFor(() => expect(api.update).toHaveBeenCalledWith('s1', { active: false }));
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('enables a disabled webhook', async () => {
    api.list.mockResolvedValue([{ ...SUB, active: false, rotating: true }]);
    api.update.mockResolvedValue(SUB);
    renderPage();
    await screen.findByText('Rotating');

    fireEvent.click(screen.getByText('Enable'));

    await waitFor(() => expect(api.update).toHaveBeenCalledWith('s1', { active: true }));
  });

  it('deletes after confirming, and does nothing when the confirm is declined', async () => {
    api.remove.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText(SUB.url);

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByLabelText(`Delete ${SUB.url}`));
    expect(api.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(`Delete ${SUB.url}`));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('s1'));
  });

  it('does not rotate when the confirm is declined', async () => {
    renderPage();
    await screen.findByText(SUB.url);

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByLabelText(`Rotate secret for ${SUB.url}`));

    expect(api.rotateSecret).not.toHaveBeenCalled();
  });

  it('refuses to create without a URL', async () => {
    renderPage();
    await screen.findByText(SUB.url);

    fireEvent.click(screen.getByText('Add webhook'));
    fireEvent.click(screen.getByText('Create'));

    expect(api.create).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });

  it('reports a refused URL and keeps the dialog open', async () => {
    api.create.mockRejectedValue(new Error('URL points at a private or reserved address'));
    renderPage();
    await screen.findByText(SUB.url);

    fireEvent.click(screen.getByText('Add webhook'));
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://10.0.0.1/h' } });
    fireEvent.click(screen.getByLabelText('customer.created'));
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error', variant: 'destructive' }))
    );
    expect(api.create).toHaveBeenCalledWith({ url: 'https://10.0.0.1/h', events: ['order.created', 'customer.created'] });
    expect(screen.getByLabelText('URL')).toBeInTheDocument();
  });

  it('shows the empty state and reports a failed load', async () => {
    api.list.mockRejectedValue(new Error('offline'));
    renderPage();

    await screen.findByText('No webhooks yet.');
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error' })));
  });

  it('reports failed toggle, delete and rotate', async () => {
    api.update.mockRejectedValue(new Error('x'));
    api.remove.mockRejectedValue(new Error('x'));
    api.rotateSecret.mockRejectedValue(new Error('x'));
    renderPage();
    await screen.findByText(SUB.url);

    fireEvent.click(screen.getByText('Disable'));
    fireEvent.click(screen.getByLabelText(`Delete ${SUB.url}`));
    fireEvent.click(screen.getByLabelText(`Rotate secret for ${SUB.url}`));

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(3));
  });

  it('copies the revealed secret', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPage();
    await screen.findByText(SUB.url);

    fireEvent.click(screen.getByLabelText(`Rotate secret for ${SUB.url}`));
    fireEvent.click(await screen.findByLabelText('Copy secret'));

    expect(writeText).toHaveBeenCalledWith('whsec_rotated_once');
  });

  describe('delivery log', () => {
    const DELIVERY = {
      id: 'd1', eventId: 'e1', eventType: 'order.created', subscriptionId: 's1', status: 'dead',
      attempts: 6, nextAttemptAt: 0, lastStatusCode: 500, lastError: null, createdAt: 0,
    };

    function openLog() {
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Deliveries' }), { button: 0 });
    }

    it('lists deliveries, filters by status, and redelivers', async () => {
      api.deliveries.mockResolvedValue([DELIVERY]);
      api.redeliver.mockResolvedValue(undefined);
      renderPage();
      await screen.findByText(SUB.url);
      openLog();

      expect(await screen.findByText('HTTP 500')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'dead' }));
      await waitFor(() => expect(api.deliveries).toHaveBeenLastCalledWith('dead'));

      fireEvent.click(screen.getByRole('button', { name: 'All' }));
      await waitFor(() => expect(api.deliveries).toHaveBeenLastCalledWith(undefined));

      fireEvent.click(screen.getByLabelText('Redeliver order.created'));
      await waitFor(() => expect(api.redeliver).toHaveBeenCalledWith('d1'));
      expect(toast).toHaveBeenCalledWith({ title: 'Queued for redelivery' });
    });

    it('shows the empty log and reports failures', async () => {
      api.deliveries.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([{ ...DELIVERY, lastError: 'timeout' }]);
      api.redeliver.mockRejectedValue(new Error('x'));
      renderPage();
      await screen.findByText(SUB.url);
      openLog();

      await screen.findByText('No deliveries.');
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error' }));

      fireEvent.click(screen.getByRole('button', { name: 'failed' }));
      fireEvent.click(await screen.findByLabelText('Redeliver order.created'));
      await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
      expect(screen.getByText('timeout')).toBeInTheDocument();
    });
  });
});
