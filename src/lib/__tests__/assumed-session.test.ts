import { describe, it, expect, beforeEach } from 'vitest';
import { authStore } from '../auth-store';
import { readAssumedSession, writeAssumedSession } from '../auth-store';

/**
 * The record of an assumed till session, which drives the banner.
 *
 * The failure that matters is the banner outliving the session it describes: a
 * till that says "Admin is covering Sam's till" over an ordinary cashier's PIN
 * session is worse than no banner at all, because it is a claim about who the
 * sales belong to.
 */
beforeEach(() => localStorage.clear());

describe('assumed session record', () => {
  it('round-trips what the banner needs', () => {
    writeAssumedSession({ adminName: 'Admin User', actingAs: 'Sam Cashier' });

    expect(readAssumedSession()).toEqual({ adminName: 'Admin User', actingAs: 'Sam Cashier' });
  });

  it('reads as absent at an ordinary till', () => {
    expect(readAssumedSession()).toBeNull();
  });

  it('keeps a null cashier as null rather than losing the field', () => {
    writeAssumedSession({ adminName: 'Admin User', actingAs: null });

    expect(readAssumedSession()).toEqual({ adminName: 'Admin User', actingAs: null });
  });

  it('clears when written null', () => {
    writeAssumedSession({ adminName: 'Admin User', actingAs: 'Sam' });

    writeAssumedSession(null);

    expect(readAssumedSession()).toBeNull();
  });

  it('does not outlive the session it describes', () => {
    // Signing out clears the token; the banner must go with it, or the next
    // cashier at this till is told their sales belong to an admin.
    writeAssumedSession({ adminName: 'Admin User', actingAs: 'Sam' });
    authStore.setToken('jwt', '24h');

    authStore.clearToken();

    expect(readAssumedSession()).toBeNull();
  });

  it('survives nothing but valid JSON, rather than throwing at the till', () => {
    // Anything could have written this key; a crash here would take the whole
    // POS down on mount.
    localStorage.setItem('assumed_session', 'not json');

    expect(readAssumedSession()).toBeNull();
  });
});
