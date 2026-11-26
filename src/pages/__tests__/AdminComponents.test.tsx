import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

/** Dependency management: list, filter, check for updates, update selected / all. */

const COMPONENTS = [
  { name: 'react', currentVersion: '18.3.1', type: 'frontend', category: 'framework' },
  { name: 'vite', currentVersion: '5.0.0', type: 'frontend', category: 'build' },
  { name: 'express', currentVersion: '4.19.0', type: 'backend', category: 'framework' },
];
const UPDATES = [
  { name: 'vite', currentVersion: '5.0.0', latestVersion: '6.0.0', type: 'frontend', category: 'build' },
  { name: 'express', currentVersion: '4.19.0', latestVersion: '5.0.0', type: 'backend', category: 'framework' },
];

const { componentsApi } = vi.hoisted(() => ({
  componentsApi: { list: vi.fn(), updates: vi.fn(), update: vi.fn(), updateAll: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ componentsApi }));
vi.mock('@/lib/auth', () => ({ getCurrentSession: async () => null }));

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn(), toasts: [] }),
}));
vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { default: AdminComponents } = await import('../admin/AdminComponents');

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminComponents />
    </MemoryRouter>
  );
}

function openTab(name: RegExp) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

const panel = () => screen.getByRole('tabpanel');
const rowFor = (name: string) => within(panel()).getByText(name).closest('tr') as HTMLElement;
const toastTitled = (title: string) => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title }));

async function checkUpdates() {
  fireEvent.click(screen.getByRole('button', { name: /check for updates/i }));
  await waitFor(() => toastTitled('Updates Available'));
}

beforeEach(() => {
  vi.clearAllMocks();
  componentsApi.list.mockResolvedValue(COMPONENTS);
  componentsApi.updates.mockResolvedValue(UPDATES);
  componentsApi.update.mockResolvedValue({});
  componentsApi.updateAll.mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminComponents', () => {
  it('lists every component and filters by search', async () => {
    renderPage();

    expect(await screen.findByText('express')).toBeInTheDocument();
    expect(screen.getByText('3 component(s) found')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search components...'), { target: { value: 'VI' } });
    expect(screen.getByText('1 component(s) found')).toBeInTheDocument();
  });

  it('reports a failed load and an empty response', async () => {
    componentsApi.list.mockRejectedValueOnce(new Error('Forbidden'));
    const { unmount } = renderPage();
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Forbidden' })));
    unmount();

    componentsApi.list.mockResolvedValueOnce(null);
    renderPage();
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Unexpected response format from server' }))
    );
  });

  it('marks packages with updates once checked, and says when all are current', async () => {
    renderPage();
    await screen.findByText('express');

    await checkUpdates();
    expect(within(rowFor('vite')).getByText('Update Available')).toBeInTheDocument();
    expect(within(rowFor('react')).getByText('Up to Date')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /updates available/i })).toHaveTextContent('2');

    componentsApi.updates.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }));
    await waitFor(() => toastTitled('All Up to Date'));
  });

  it('reports a failed update check', async () => {
    componentsApi.updates.mockRejectedValue(new Error('Registry down'));
    renderPage();
    await screen.findByText('express');

    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Registry down' })));
  });

  it('updates the selected frontend packages after confirming', async () => {
    renderPage();
    await screen.findByText('express');
    await checkUpdates();

    fireEvent.click(within(rowFor('react')).getByRole('checkbox'));
    fireEvent.click(within(rowFor('vite')).getByRole('checkbox'));
    fireEvent.click(within(rowFor('react')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /update selected \(1\)/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('5.0.0 → 6.0.0')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Update' }));

    await waitFor(() => expect(componentsApi.update).toHaveBeenCalledWith(['vite'], 'frontend'));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Packages updated successfully' })));
    expect(componentsApi.list).toHaveBeenCalledTimes(2);
  });

  it('reports a failed update and Cancel closes the dialog', async () => {
    componentsApi.update.mockRejectedValue(new Error('npm ERR!'));
    renderPage();
    await screen.findByText('express');

    fireEvent.click(within(rowFor('react')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /update selected/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Update' }));
    await waitFor(() => toastTitled('Update Failed'));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('select-all in the All tab selects and clears every visible package', async () => {
    renderPage();
    await screen.findByText('express');
    const [selectAll] = within(panel()).getAllByRole('checkbox');

    fireEvent.click(selectAll);
    expect(screen.getByRole('button', { name: /update selected \(3\)/i })).toBeInTheDocument();
    fireEvent.click(selectAll);
    expect(screen.queryByRole('button', { name: /update selected/i })).not.toBeInTheDocument();
  });

  it('Frontend and Backend tabs list only their side and select-all within it', async () => {
    renderPage();
    await screen.findByText('express');

    openTab(/^frontend$/i);
    expect(within(panel()).getByText('2 component(s)')).toBeInTheDocument();
    expect(within(panel()).queryByText('express')).not.toBeInTheDocument();
    const [frontAll] = within(panel()).getAllByRole('checkbox');
    fireEvent.click(frontAll);
    expect(screen.getByRole('button', { name: /update selected \(2\)/i })).toBeInTheDocument();
    fireEvent.click(within(rowFor('vite')).getByRole('checkbox'));
    fireEvent.click(frontAll);
    expect(screen.getByRole('button', { name: /update selected \(2\)/i })).toBeInTheDocument();
    fireEvent.click(frontAll);
    expect(screen.queryByRole('button', { name: /update selected/i })).not.toBeInTheDocument();

    openTab(/^backend$/i);
    expect(within(panel()).getByText('express')).toBeInTheDocument();
    const [backAll] = within(panel()).getAllByRole('checkbox');
    fireEvent.click(backAll);
    fireEvent.click(backAll);
    fireEvent.click(within(rowFor('express')).getByRole('checkbox'));
    expect(screen.getByRole('button', { name: /update selected \(1\)/i })).toBeInTheDocument();
  });

  it('updates all packages on one side only after confirming', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    renderPage();
    await screen.findByText('express');

    openTab(/^backend$/i);
    fireEvent.click(within(panel()).getByRole('button', { name: /update all backend/i }));
    expect(componentsApi.updateAll).not.toHaveBeenCalled();

    fireEvent.click(within(panel()).getByRole('button', { name: /update all backend/i }));
    await waitFor(() => expect(componentsApi.updateAll).toHaveBeenCalledWith('backend'));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'All packages updated successfully' })));

    openTab(/^frontend$/i);
    componentsApi.updateAll.mockRejectedValueOnce(new Error('Disk full'));
    fireEvent.click(within(panel()).getByRole('button', { name: /update all frontend/i }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Disk full' })));
    expect(confirmSpy).toHaveBeenCalledTimes(3);
  });

  it('the Updates tab lists pending updates, filters them, and selects all', async () => {
    renderPage();
    await screen.findByText('express');

    openTab(/updates available/i);
    expect(within(panel()).getByText(/all packages are up to date/i)).toBeInTheDocument();

    await checkUpdates();
    expect(within(panel()).getByText('6.0.0')).toBeInTheDocument();
    const [all] = within(panel()).getAllByRole('checkbox');
    fireEvent.click(all);
    expect(screen.getByRole('button', { name: /update selected \(2\)/i })).toBeInTheDocument();
    fireEvent.click(all);
    fireEvent.click(within(rowFor('vite')).getByRole('checkbox'));
    expect(screen.getByRole('button', { name: /update selected \(1\)/i })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search components...'), { target: { value: 'nothing' } });
    expect(within(panel()).getByText('No updates match your filters')).toBeInTheDocument();
  });

  /**
   * BUG (AdminComponents.tsx:568-572): the row's Update button calls
   * `setSelectedPackages([name])` and then `handleUpdateSelected()` in the same
   * handler. `handleUpdateSelected` reads `selectedPackages` from the render's
   * closure — still empty — so with nothing previously ticked it toasts
   * "No Packages Selected" and the confirmation never opens.
   */
  it.fails('a row Update button opens the confirmation for that package', async () => {
    renderPage();
    await screen.findByText('express');
    await checkUpdates();
    openTab(/updates available/i);

    fireEvent.click(within(rowFor('express')).getByRole('button', { name: /^update$/i }));

    expect(await screen.findByRole('dialog', {}, { timeout: 500 })).toBeInTheDocument();
  });

  /**
   * BUG (AdminComponents.tsx:113): `updateType` is only ever changed by the
   * Updates tab's per-row button, so "Update Selected" after ticking backend
   * packages on the Backend tab sends them with `type: 'frontend'` — the server
   * would run the install in the wrong project.
   */
  it.fails('Update Selected for backend packages sends type "backend"', async () => {
    renderPage();
    await screen.findByText('express');
    openTab(/^backend$/i);

    fireEvent.click(within(rowFor('express')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /update selected \(1\)/i }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm Update' }));

    await waitFor(() => expect(componentsApi.update).toHaveBeenCalledWith(['express'], 'backend'), { timeout: 500 });
  });

  it('warns when Update Selected is reached with nothing selected', async () => {
    renderPage();
    await screen.findByText('express');
    await checkUpdates();
    openTab(/updates available/i);

    fireEvent.click(within(rowFor('express')).getByRole('button', { name: /^update$/i }));

    toastTitled('No Packages Selected');
  });
});
