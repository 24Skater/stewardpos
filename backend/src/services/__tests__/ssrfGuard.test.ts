import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.fn();
vi.mock('dns/promises', () => ({ default: { lookup: (...args: unknown[]) => lookup(...args) } }));

import { assertSafeWebhookUrl, readAllowlist, SsrfError } from '../ssrfGuard';

describe('ssrfGuard', () => {
  beforeEach(() => {
    lookup.mockReset();
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it.each([
    'https://127.0.0.1/hook',
    'https://10.0.0.5/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://2130706433/hook',
    'https://100.64.1.1/hook',
    'https://[fd00::1]/hook',
    'https://[::ffff:127.0.0.1]/hook',
  ])('refuses %s', async (url) => {
    await expect(assertSafeWebhookUrl(url, [])).rejects.toBeInstanceOf(SsrfError);
  });

  it('refuses a hostname that resolves to a private address', async () => {
    lookup.mockResolvedValue([{ address: '192.168.1.20', family: 4 }]);
    await expect(assertSafeWebhookUrl('https://rebind.example.test/hook', [])).rejects.toBeInstanceOf(SsrfError);
  });

  it('refuses when any resolved address is private', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.1.1', family: 4 },
    ]);
    await expect(assertSafeWebhookUrl('https://mixed.example.test/hook', [])).rejects.toBeInstanceOf(SsrfError);
  });

  it('requires https for a host that is not allow-listed', async () => {
    await expect(assertSafeWebhookUrl('http://public.example.test/hook', [])).rejects.toBeInstanceOf(SsrfError);
  });

  it('accepts a public https host', async () => {
    await expect(assertSafeWebhookUrl('https://public.example.test/hook', [])).resolves.toBeUndefined();
  });

  it('lets an allow-listed LAN host through, over http', async () => {
    await expect(assertSafeWebhookUrl('http://192.168.1.50:8080/hook', ['192.168.1.50:8080'])).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not let the allow-list match a different port', async () => {
    await expect(assertSafeWebhookUrl('https://192.168.1.50:9000/hook', ['192.168.1.50:8080'])).rejects.toBeInstanceOf(
      SsrfError
    );
  });

  it('reads the allow-list from settings, lower-cased', () => {
    expect(readAllowlist({ providers: { webhookAllowlist: ['Pos.LAN:8080', 3] } })).toEqual(['pos.lan:8080']);
    expect(readAllowlist(null)).toEqual([]);
  });
});
