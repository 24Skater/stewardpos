import dns from 'dns/promises';
import net from 'net';

/**
 * Webhook URLs are typed in by an admin but fetched by the server, so a URL can
 * aim the server at things only it can reach: cloud metadata, the database,
 * a sibling on the LAN. Every address a host resolves to must be public unless
 * the operator lists that exact host:port in `settings.providers.webhookAllowlist`.
 */

const BLOCKED = new net.BlockList();
for (const [addr, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast and reserved
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(addr, bits, 'ipv4');
}
BLOCKED.addAddress('::', 'ipv6');
BLOCKED.addAddress('::1', 'ipv6');
BLOCKED.addSubnet('fc00::', 7, 'ipv6');
BLOCKED.addSubnet('fe80::', 10, 'ipv6');
BLOCKED.addSubnet('ff00::', 8, 'ipv6');

export class SsrfError extends Error {}

function isBlockedAddress(address: string): boolean {
  if (net.isIP(address) === 4) return BLOCKED.check(address, 'ipv4');
  // An IPv4-mapped IPv6 address (::ffff:7f00:1) is the IPv4 address in disguise.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return BLOCKED.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, 'ipv4');
  }
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (dotted) return BLOCKED.check(dotted[1], 'ipv4');
  return BLOCKED.check(address, 'ipv6');
}

/** `settings.providers.webhookAllowlist`, as lower-cased `host:port` entries. */
export function readAllowlist(settings: { providers?: Record<string, unknown> } | null | undefined): string[] {
  const raw = settings?.providers?.webhookAllowlist;
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase()) : [];
}

/**
 * Throws SsrfError unless the URL is safe to call. Run at save time and again
 * before every send, so a hostname that later re-points at a private address
 * is caught.
 */
// shortcut: the send re-resolves the name, so a rebind between check and fetch is
// still possible; upgrade by connecting to the vetted IP with a pinned dispatcher.
export async function assertSafeWebhookUrl(rawUrl: string, allowlist: string[]): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('Invalid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SsrfError('URL must be http or https');
  if (url.username || url.password) throw new SsrfError('URL must not contain credentials');

  // The URL parser has already normalised 2130706433, 0x7f.1 and similar to dotted form.
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (allowlist.includes(`${host}:${port}`)) return;

  if (url.protocol !== 'https:') throw new SsrfError('URL must use https');

  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new SsrfError('Host could not be resolved');
    }
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new SsrfError('URL points at a private or reserved address');
  }
}
