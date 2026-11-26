import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Opening and closing the till: the float recorded, the variance a cashier
 * sees before sealing the count, and what they are told afterwards.
 */

const current = vi.fn();
const openDrawer = vi.fn();
const closeDrawer = vi.fn();
vi.mock('@/lib/api', () => ({
  drawerApi: {
    current: () => current(),
    open: (float: number) => openDrawer(float),
    close: (counted: number, notes?: string) => closeDrawer(counted, notes),
  },
}));

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn(), toasts: [] }),
}));

const CashDrawerDialog = (await import('../CashDrawerDialog')).default;

const OPEN_SESSION = { id: 'ds1', openedByName: 'Casey', openingFloat: 100, expectedCash: 250 };

function renderDrawer(open = true) {
  const onOpenChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CashDrawerDialog open={open} onOpenChange={onOpenChange} />
    </QueryClientProvider>
  );
  return { onOpenChange };
}

const toastTitled = (title: string) => expect.objectContaining({ title });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CashDrawerDialog with no drawer open', () => {
  beforeEach(() => current.mockResolvedValue(null));

  it('opens the drawer with the float counted in', async () => {
    openDrawer.mockResolvedValue({ id: 'ds2' });
    renderDrawer();

    fireEvent.change(await screen.findByLabelText('Opening float'), { target: { value: '150.25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open Drawer' }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(toastTitled('Drawer opened')));
    expect(openDrawer).toHaveBeenCalledWith(150.25);
  });

  it('treats an empty float as zero', async () => {
    openDrawer.mockResolvedValue({ id: 'ds2' });
    renderDrawer();

    await screen.findByLabelText('Opening float');
    fireEvent.click(screen.getByRole('button', { name: 'Open Drawer' }));

    await waitFor(() => expect(openDrawer).toHaveBeenCalledWith(0));
  });

  it('explains why the drawer could not be opened', async () => {
    openDrawer.mockRejectedValue(new Error('A drawer is already open'));
    renderDrawer();

    await screen.findByLabelText('Opening float');
    fireEvent.click(screen.getByRole('button', { name: 'Open Drawer' }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Could not open the drawer', description: 'A drawer is already open' })
      )
    );
  });

  it('cancels without opening anything', async () => {
    const { onOpenChange } = renderDrawer();

    await screen.findByLabelText('Opening float');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(openDrawer).not.toHaveBeenCalled();
  });
});

describe('CashDrawerDialog loading', () => {
  it('does not ask the server while closed', () => {
    renderDrawer(false);

    expect(current).not.toHaveBeenCalled();
  });

  it('shows why the drawer could not be loaded', async () => {
    current.mockRejectedValue(new Error('Drawer service unavailable'));
    renderDrawer();

    expect(await screen.findByText('Drawer service unavailable')).toBeInTheDocument();
  });
});

describe('CashDrawerDialog closing an open drawer', () => {
  beforeEach(() => current.mockResolvedValue(OPEN_SESSION));

  async function countCash(amount: string) {
    fireEvent.change(await screen.findByLabelText('Counted cash'), { target: { value: amount } });
  }

  it('shows who opened it and the server-computed expected cash', async () => {
    renderDrawer();

    const summary = (await screen.findByText('Expected in drawer')).closest('dl') as HTMLElement;
    expect(within(summary).getByText('Casey')).toBeInTheDocument();
    expect(within(summary).getByText('$100.00')).toBeInTheDocument();
    expect(within(summary).getByText('$250.00')).toBeInTheDocument();
  });

  it('names an unknown opener rather than leaving it blank', async () => {
    current.mockResolvedValue({ ...OPEN_SESSION, openedByName: null });
    renderDrawer();

    expect(await screen.findByText('Unknown')).toBeInTheDocument();
  });

  it('will not close until a count is entered', async () => {
    renderDrawer();

    await screen.findByLabelText('Counted cash');

    expect(screen.getByRole('button', { name: 'Close Drawer' })).toBeDisabled();
  });

  it.each([
    ['250', 'Balances exactly'],
    ['240.5', 'Short by $9.50'],
    ['260', 'Over by $10.00'],
  ])('previews a count of %s as "%s" before committing', async (amount, preview) => {
    renderDrawer();

    await countCash(amount);

    expect(screen.getByText(preview)).toBeInTheDocument();
    expect(closeDrawer).not.toHaveBeenCalled();
  });

  it('submits the count with notes', async () => {
    closeDrawer.mockResolvedValue({ variance: 0 });
    renderDrawer();
    await countCash('250');
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'All good' } });

    fireEvent.click(screen.getByRole('button', { name: 'Close Drawer' }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Drawer closed', description: 'The till balanced exactly.' })
      )
    );
    expect(closeDrawer).toHaveBeenCalledWith(250, 'All good');
  });

  it('flags a short till as a problem', async () => {
    closeDrawer.mockResolvedValue({ variance: -9.5 });
    renderDrawer();
    await countCash('240.5');

    fireEvent.click(screen.getByRole('button', { name: 'Close Drawer' }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Short by $9.50.', variant: 'destructive' })
      )
    );
    expect(closeDrawer).toHaveBeenCalledWith(240.5, undefined);
  });

  it('reports an over till without alarm', async () => {
    closeDrawer.mockResolvedValue({ variance: 10 });
    renderDrawer();
    await countCash('260');

    fireEvent.click(screen.getByRole('button', { name: 'Close Drawer' }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Over by $10.00.', variant: 'default' })
      )
    );
  });

  it('treats a missing variance as balanced', async () => {
    closeDrawer.mockResolvedValue({});
    renderDrawer();
    await countCash('250');

    fireEvent.click(screen.getByRole('button', { name: 'Close Drawer' }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'The till balanced exactly.' }))
    );
  });

  it('explains why the drawer could not be closed', async () => {
    closeDrawer.mockRejectedValue(new Error('Drawer already closed'));
    renderDrawer();
    await countCash('250');

    fireEvent.click(screen.getByRole('button', { name: 'Close Drawer' }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Could not close the drawer', description: 'Drawer already closed' })
      )
    );
  });
});
