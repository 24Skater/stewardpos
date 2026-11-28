import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

/** Template editor: pick one, edit or switch it off, preview, save, and say so when the server refuses. */

const RECEIPT = {
  key: 'receipt',
  channel: 'email',
  subject: 'Your receipt',
  body: 'Thanks {{customerName}}',
  enabled: true,
  isDefault: true,
  vars: ['customerName', 'total'],
};

const templates = { list: vi.fn(), save: vi.fn(), preview: vi.fn() };
const toast = vi.fn();
vi.mock('@/lib/api', () => ({ adminApi: { templates } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast, dismiss: vi.fn(), toasts: [] }) }));
vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { default: AdminTemplates } = await import('../admin/AdminTemplates');

beforeEach(() => {
  vi.clearAllMocks();
  templates.list.mockResolvedValue([RECEIPT, { ...RECEIPT, channel: 'sms', enabled: false }]);
  templates.save.mockResolvedValue(undefined);
  templates.preview.mockResolvedValue({ subject: 'Your receipt', text: 'Thanks Ada' });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminTemplates />
    </MemoryRouter>
  );
}

async function openReceiptEmail() {
  renderPage();
  fireEvent.click(await screen.findByText('receipt (email)'));
}

describe('AdminTemplates', () => {
  it('lists templates and marks the ones switched off', async () => {
    renderPage();
    expect(await screen.findByText('receipt (email)')).toBeInTheDocument();
    expect(screen.getByText('receipt (sms) - off')).toBeInTheDocument();
    expect(screen.queryByLabelText('Body')).not.toBeInTheDocument();
  });

  it('shows the variables a template can use', async () => {
    await openReceiptEmail();
    expect(screen.getByText('Variables: {{customerName}}, {{total}}')).toBeInTheDocument();
  });

  it('saves the edited subject, body and switch', async () => {
    await openReceiptEmail();

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Receipt' } });
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Hi {{customerName}}' } });
    fireEvent.click(screen.getByLabelText('Send this message'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(templates.save).toHaveBeenCalledWith('receipt', 'email', {
        subject: 'Receipt',
        body: 'Hi {{customerName}}',
        enabled: false,
      })
    );
    expect(toast).toHaveBeenCalledWith({ title: 'Template saved' });
    expect(templates.list).toHaveBeenCalledTimes(2);
  });

  it('previews the draft, and clears the preview when another template is picked', async () => {
    await openReceiptEmail();

    fireEvent.click(screen.getByText('Preview'));

    expect(await screen.findByText('Thanks Ada')).toBeInTheDocument();
    expect(templates.preview).toHaveBeenCalledWith('receipt', 'email', {
      subject: 'Your receipt',
      body: 'Thanks {{customerName}}',
      enabled: true,
    });

    fireEvent.click(screen.getByText('receipt (sms) - off'));
    expect(screen.queryByText('Thanks Ada')).not.toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    templates.list.mockRejectedValueOnce(new Error('offline'));
    renderPage();
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not load templates', variant: 'destructive' }))
    );
  });

  it('reports a refused save or preview', async () => {
    templates.save.mockRejectedValue(new Error('Unknown variable'));
    templates.preview.mockRejectedValue(new Error('Unknown variable'));
    await openReceiptEmail();

    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not save template', variant: 'destructive' }))
    );

    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not preview', variant: 'destructive' }))
    );
  });
});
