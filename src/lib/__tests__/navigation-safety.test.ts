import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { safeRedirect, DEFAULT_REDIRECT } from '../safe-redirect';

/**
 * Nothing may navigate to a value the visitor controls unless `safeRedirect`
 * has cleared it.
 *
 * This exists because of two open advisories against react-router 6
 * (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg), both fixed upstream only in
 * v7.18.0 — a major-version migration. Neither is exploitable here, and this
 * test is what keeps that true:
 *
 *   - The constructor-injection advisory says of itself that it "does not
 *     impact your application if you are using Declarative Mode", and only
 *     affects Framework or Data Mode with manual SSR/hydration. This app is a
 *     Vite SPA using `BrowserRouter` + `<Routes>`, with no SSR at all. The
 *     first assertion below is what stops someone quietly moving it to
 *     `createBrowserRouter` and inheriting the exposure.
 *
 *   - The open-redirect advisory needs attacker-supplied input reaching a
 *     navigation. `safeRedirect` (added in #46) normalises backslashes before
 *     testing the path, which is exactly the bypass react-router carries until
 *     v7.18.0. The second assertion is what stops a new unguarded call site.
 *
 * So the audit finding is a version range, not a live exposure — and the two
 * facts holding that up are asserted here rather than remembered. If either
 * fails, the reasoning for staying on v6 has expired and the upgrade is due.
 */

const SOURCE_ROOT = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Tests describe unsafe navigation in order to assert it is refused.
      return entry === '__tests__' || entry === 'test' ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const files = sourceFiles(SOURCE_ROOT).map((file) => ({
  path: path.relative(SOURCE_ROOT, file).split(path.sep).join('/'),
  text: readFileSync(file, 'utf8'),
}));

/**
 * A navigation target that is not a literal string.
 *
 * Literals are safe by construction — the author wrote the destination — so
 * only the rest is interesting.
 */
function dynamicNavigationTargets(): Array<{ file: string; target: string }> {
  const found: Array<{ file: string; target: string }> = [];

  for (const { path: file, text } of files) {
    // `navigate(<target>)`, `navigate(<target>, { replace: true })`.
    for (const match of text.matchAll(/\bnavigate\(\s*([^,)]+)/g)) {
      const target = match[1].trim();
      if (/^['"`]/.test(target)) continue;
      found.push({ file, target });
    }

    // `to={...}` and `href={...}` on anything that routes.
    for (const match of text.matchAll(/\b(?:to|href)=\{([^}]+)\}/g)) {
      const target = match[1].trim();
      if (/^['"`]/.test(target)) continue;
      found.push({ file, target });
    }
  }

  return found;
}

/**
 * Dynamic targets that have been read and found safe.
 *
 * Deliberately an exact list rather than a pattern. A new dynamic navigation
 * should fail this test and be looked at by a person; that is the entire
 * mechanism. Adding an entry here is the act of saying "I checked this one".
 */
const REVIEWED: Array<{ target: string; why: string }> = [
  {
    target: 'safeRedirect(',
    why: 'The guarded case. `safeRedirect` refuses anything leaving the origin.',
  },
  {
    target: 'item.path',
    why: '`navItems` in AdminLayout.tsx is a module-level constant of string literals.',
  },
];

describe('navigation safety', () => {
  it('reads the source it is supposed to be checking', () => {
    // Without this, a broken path would make every assertion below pass by
    // finding nothing at all.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.path === 'pages/Login.tsx')).toBe(true);
  });

  it('routes only in react-router Declarative Mode', () => {
    // Data Mode is what the constructor-injection advisory affects. Moving to
    // it means that advisory starts applying and v6 stops being tenable.
    const all = files.map((f) => f.text).join('\n');
    for (const dataModeApi of [
      'createBrowserRouter',
      'createHashRouter',
      'createMemoryRouter',
      'RouterProvider',
      'useLoaderData',
      'useActionData',
    ]) {
      expect(all, `${dataModeApi} moves this app into react-router Data Mode`).not.toContain(
        dataModeApi
      );
    }
  });

  it('sends no unreviewed dynamic value to a navigation', () => {
    const unreviewed = dynamicNavigationTargets().filter(
      ({ target }) => !REVIEWED.some((entry) => target.startsWith(entry.target))
    );

    expect(
      unreviewed,
      'A navigation target that is not a string literal. If it can carry ' +
        'anything a visitor supplies, route it through safeRedirect(); if it ' +
        'cannot, add it to REVIEWED with the reason.'
    ).toEqual([]);
  });

  it('guards the one place a visitor-supplied path reaches a navigation', () => {
    const login = files.find((f) => f.path === 'pages/Login.tsx');
    expect(login).toBeDefined();
    // `?next=` is attacker-controllable: the whole URL is what gets sent in a
    // phishing mail. It must never reach `navigate` unwrapped.
    expect(login!.text).toMatch(/navigate\(\s*safeRedirect\(/);
    expect(login!.text).not.toMatch(/navigate\(\s*searchParams\.get/);
  });

  it('keeps safeRedirect refusing the backslash escape', () => {
    // The precise thing react-router 6 gets wrong, asserted as behaviour rather
    // than by grepping the implementation: a backslash in the authority
    // position is delivered as a slash, so this must not survive as a target.
    const backslashEscape = ['/', String.fromCharCode(92), 'evil.example'].join('');
    expect(safeRedirect(backslashEscape)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect('//evil.example')).toBe(DEFAULT_REDIRECT);
    // And a genuine in-app path still works, so the guard is not just refusing
    // everything.
    expect(safeRedirect('/admin/reports')).toBe('/admin/reports');
  });
});
