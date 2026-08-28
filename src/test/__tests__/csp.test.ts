import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The shipped Content-Security-Policy, checked against the page it protects.
 *
 * These two files drift apart silently. `index.html` gained three Google Fonts
 * stylesheets and `nginx.conf` was never told, so the policy named neither
 * `fonts.googleapis.com` under `style-src` nor `fonts.gstatic.com` under
 * `font-src`.
 *
 * That did no harm only because of a second bug: the headers were not being
 * sent at all (see the `nginx header inheritance` block below), so nothing
 * enforced the policy. Repairing that on its own would have blocked all three
 * stylesheets and loaded zero font faces — a booby trap set for whoever fixed
 * the real problem.
 *
 * So the invariant is asserted rather than remembered: every origin the page
 * reaches for must be named in the directive that governs it.
 */

const repoRoot = path.resolve(__dirname, '../../..');
const html = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const nginx = readFileSync(path.join(repoRoot, 'nginx.conf'), 'utf8');
const headers = readFileSync(path.join(repoRoot, 'nginx-security-headers.conf'), 'utf8');

/** The policy as one string, lifted out of the `add_header` line. */
function contentSecurityPolicy(): string {
  const match = headers.match(/add_header\s+Content-Security-Policy\s+"([^"]+)"/);
  if (!match) throw new Error('No Content-Security-Policy in nginx-security-headers.conf');
  return match[1];
}

/** One directive's source list, e.g. `directive('font-src')`. */
function directive(name: string): string[] {
  const found = contentSecurityPolicy()
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  if (found === undefined) throw new Error(`CSP has no ${name} directive`);
  return found.slice(name.length).trim().split(/\s+/).filter(Boolean);
}

describe('Content-Security-Policy', () => {
  it('allows every external origin index.html loads a stylesheet from', () => {
    // `<link rel="stylesheet" href="https://...">` is governed by style-src.
    const stylesheetOrigins = [
      ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g),
    ]
      .map((tag) => tag[0].match(/href="(https:\/\/[^/"]+)/)?.[1])
      .filter((origin): origin is string => Boolean(origin));

    // Guards the guard: if the fonts are ever removed from index.html this
    // assertion would pass vacuously and stop meaning anything.
    expect(stylesheetOrigins.length).toBeGreaterThan(0);

    for (const origin of new Set(stylesheetOrigins)) {
      expect(directive('style-src')).toContain(origin);
    }
  });

  it('allows the font host that the stylesheet origin serves files from', () => {
    // Google's CSS references fonts.gstatic.com, which never appears in our
    // HTML — so it cannot be derived from the markup and has to be asserted
    // directly, or font-src silently loses it again.
    if (contentSecurityPolicy().includes('fonts.googleapis.com')) {
      expect(directive('font-src')).toContain('https://fonts.gstatic.com');
    }
  });

  it("does not allow inline script, because the build emits none", () => {
    // Vite emits a single `<script type="module" src=...>`. If that ever
    // changes, this test failing is the signal to add a nonce rather than to
    // quietly reopen the hole.
    expect(directive('script-src')).not.toContain("'unsafe-inline'");
    expect(directive('script-src')).not.toContain("'unsafe-eval'");
  });

  it('has no inline script in the source HTML either', () => {
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .filter((match) => match[1].trim().length > 0);
    expect(inline).toHaveLength(0);
  });

  it('forbids framing, plugins, and base-tag rewriting', () => {
    expect(directive('frame-ancestors')).toEqual(["'none'"]);
    expect(directive('object-src')).toEqual(["'none'"]);
    expect(directive('base-uri')).toEqual(["'self'"]);
    expect(directive('form-action')).toEqual(["'self'"]);
  });

  it('sends the same Permissions-Policy the Caddyfile sends in production', () => {
    const caddy = readFileSync(path.join(repoRoot, 'Caddyfile'), 'utf8');
    for (const feature of ['camera=()', 'microphone=()', 'geolocation=()']) {
      expect(headers).toContain(feature);
      expect(caddy).toContain(feature);
    }
  });
});

describe('nginx header inheritance', () => {
  /**
   * The bug this exists to prevent, which had already happened.
   *
   * nginx inherits `add_header` from an outer block only when the inner block
   * declares none of its own. One `add_header Cache-Control "public"` in a
   * location therefore removes the CSP, HSTS, nosniff and the rest from every
   * response that location serves - silently, with the directives still sitting
   * correctly in the server block above.
   *
   * `location = /index.html` set three cache headers, and `location /`'s
   * `try_files` rewrites every SPA route into it, so the document that boots
   * the entire application was served with no security headers at all. The
   * config looked right. Only the response told the truth.
   *
   * Asserted structurally rather than by fetching, because the whole difficulty
   * is that this is invisible without an HTTP client and a running container.
   */
  const locationBlocks = (): Array<{ header: string; body: string }> => {
    // Comments first. The word "location" appears in the prose explaining why
    // these includes exist, and a parser that reads commentary as configuration
    // reports blocks that do not exist while missing ones that do.
    const source = nginx.replace(/#.*/g, '');

    const blocks: Array<{ header: string; body: string }> = [];
    const re = /location\s+([^{]+)\{/g;
    let match: RegExpExecArray | null;

    while ((match = re.exec(source)) !== null) {
      // Walk braces from the opening one to find this block's extent, so a
      // nested block cannot end the scan early.
      let depth = 1;
      let i = re.lastIndex;
      while (i < source.length && depth > 0) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') depth--;
        i++;
      }
      blocks.push({ header: match[1].trim(), body: source.slice(re.lastIndex, i - 1) });
    }
    return blocks;
  };

  it('finds the location blocks it is meant to be checking', () => {
    // Without this the regex silently matching nothing would make every
    // assertion below pass by vacuity.
    const headerNames = locationBlocks().map((block) => block.header);
    expect(headerNames).toEqual(
      expect.arrayContaining(['/api/', '^~ /uploads/', '/', '= /index.html'])
    );
  });

  it('re-includes the security headers in every location that sets its own', () => {
    for (const block of locationBlocks()) {
      if (!/^\s*add_header/m.test(block.body)) continue;
      expect(
        block.body,
        `location ${block.header} sets add_header, so it drops every inherited ` +
          `security header unless it includes security-headers.conf`
      ).toMatch(/include\s+\/etc\/nginx\/conf\.d\/security-headers\.conf;/);
    }
  });

  it('keeps the server-level include for locations that set no header', () => {
    expect(nginx).toMatch(/include\s+\/etc\/nginx\/conf\.d\/security-headers\.conf;/);
  });

  it('ships the snippet into the image', () => {
    // The include is an absolute path inside the container. If the Dockerfile
    // does not copy the file there, nginx refuses to start.
    const dockerfile = readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(
      /COPY\s+nginx-security-headers\.conf\s+\/etc\/nginx\/conf\.d\/security-headers\.conf/
    );
  });
});
