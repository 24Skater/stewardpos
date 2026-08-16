import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Applying the store's brand, and — more importantly — not asking for it when
 * there is nobody to ask on behalf of.
 *
 * This component sits above the router, so it runs on every screen including
 * `/login` and `/setup`. Settings is an authenticated endpoint and a 401 clears
 * the token and sends the browser to `/login`; fetching unconditionally would
 * therefore bounce a brand-new install out of its own first-run wizard.
 */
const getSettings = vi.fn();
const getCurrentSession = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    adminApi: { ...(actual.adminApi as object), settings: { get: getSettings } },
  };
});

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getCurrentSession };
});

const { default: StoreBranding } = await import('../StoreBranding');

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<StoreBranding />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.style.removeProperty('--st-primary');
  document.documentElement.style.removeProperty('--st-primaryFg');
  getCurrentSession.mockResolvedValue({ user: { id: 'u1' } });
  getSettings.mockResolvedValue({ brandColor: '#1B2A41', iconUrl: '/uploads/icon.png' });
});

describe('StoreBranding', () => {
  it('applies the brand colour once settings arrive', async () => {
    mount();

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--st-primary')).toBe('#1B2A41');
    });
    expect(document.documentElement.style.getPropertyValue('--st-primaryFg')).toBe('#FFFFFF');
  });

  it('sets the favicon', async () => {
    mount();

    await waitFor(() => {
      expect(document.querySelector<HTMLLinkElement>("link[rel~='icon']")?.href).toContain(
        '/uploads/icon.png'
      );
    });
  });

  it('does not ask for settings when nobody is signed in', async () => {
    // The failure this prevents: on `/setup` there is no session by definition,
    // the 401 clears the token and redirects to `/login`, and a fresh install
    // can never finish its own wizard.
    getCurrentSession.mockResolvedValue(null);

    mount();

    await waitFor(() => expect(getCurrentSession).toHaveBeenCalled());
    expect(getSettings).not.toHaveBeenCalled();
  });

  it('leaves the palette alone when the store has set no brand', async () => {
    getSettings.mockResolvedValue({});

    mount();

    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(document.documentElement.style.getPropertyValue('--st-primary')).toBe('');
  });

  it('renders nothing', () => {
    const { container } = mount();

    expect(container.innerHTML).toBe('');
  });
});
