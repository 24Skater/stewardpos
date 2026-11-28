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
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
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
});
