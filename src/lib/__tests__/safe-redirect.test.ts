import { describe, it, expect } from 'vitest';
import { safeRedirect, DEFAULT_REDIRECT } from '../safe-redirect';

/**
 * `RequireAuth` records the route it turned away in `?next=`, and Login sends
 * the visitor there once they are in. Anything that escapes the origin turns
 * that into an open redirect — a stock phishing primitive, and the more
 * dangerous half of it is that the hostile link looks like a real login URL.
 *
 * The cases below are the escape hatches, not a survey of valid paths.
 */
describe('safeRedirect', () => {
  it('honours the path RequireAuth recorded', () => {
    expect(safeRedirect('/admin')).toBe('/admin');
  });

  it('keeps the query string, which RequireAuth includes', () => {
    expect(safeRedirect('/admin/reports?period=mom')).toBe('/admin/reports?period=mom');
  });

  it('falls back when nothing was recorded', () => {
    expect(safeRedirect(null)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect('')).toBe(DEFAULT_REDIRECT);
  });

  it('refuses an absolute URL', () => {
    expect(safeRedirect('https://evil.example/login')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect('http://evil.example')).toBe(DEFAULT_REDIRECT);
  });

  it('refuses a scheme-relative URL', () => {
    expect(safeRedirect('//evil.example')).toBe(DEFAULT_REDIRECT);
  });

  /**
   * The bypass that CVE-2025-68470's fix missed, and the reason this function
   * cannot simply test for a leading `//`: react-router and the browser both
   * read a backslash here as a slash, so `/\evil.example` is delivered as
   * `//evil.example` and leaves the origin.
   */
  it('refuses a backslash standing in for the second slash', () => {
    expect(safeRedirect('/\\evil.example')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect('\\\\evil.example')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect('/\\/evil.example')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect('/\\\\evil.example')).toBe(DEFAULT_REDIRECT);
  });

  it('refuses a bare hostname', () => {
    expect(safeRedirect('evil.example')).toBe(DEFAULT_REDIRECT);
  });
});
