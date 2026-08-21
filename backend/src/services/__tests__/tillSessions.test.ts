import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import config from '../../config';
import { mintSession, TILL_SESSION_MAX_AGE } from '../tillSessions';

/**
 * The claim shape is the contract between three endpoints that mint tokens and
 * the one middleware that reads them. It is asserted here rather than through
 * a route so a drift shows up as a failure in the thing that drifted.
 */
describe('mintSession', () => {
  const user = { id: 'u1', email: 'a@b.c', roleIds: ['r1'], orgId: 'org1' };

  it('signs the identity claims a password session carries', () => {
    const { token } = mintSession({ user });

    const claims = jwt.verify(token, config.jwt.secret) as Record<string, unknown>;
    expect(claims.id).toBe('u1');
    expect(claims.email).toBe('a@b.c');
    expect(claims.roleIds).toEqual(['r1']);
    expect(claims.orgId).toBe('org1');
  });

  it('carries no shiftId when none was given, so a password session skips the shift check', () => {
    const { token } = mintSession({ user });

    const claims = jwt.verify(token, config.jwt.secret) as Record<string, unknown>;
    expect('shiftId' in claims).toBe(false);
    expect('registerId' in claims).toBe(false);
  });

  it('carries the shift it was opened for', () => {
    const { token } = mintSession({ user, shiftId: 's1', registerId: 'reg1' });

    const claims = jwt.verify(token, config.jwt.secret) as Record<string, unknown>;
    expect(claims.shiftId).toBe('s1');
    expect(claims.registerId).toBe('reg1');
  });

  it('carries a register with no shift, which is what a no-PIN till session is', () => {
    const { token } = mintSession({ user, registerId: 'reg1' });

    const claims = jwt.verify(token, config.jwt.secret) as Record<string, unknown>;
    expect('registerId' in claims).toBe(true);
    expect('shiftId' in claims).toBe(false);
  });

  it('caps an assumed session at 30 minutes regardless of the configured lifetime', () => {
    // A forgotten assumed session must close itself.
    const { token, expiresIn } = mintSession({ user, registerId: 'reg1', maxAgeSeconds: TILL_SESSION_MAX_AGE });

    const claims = jwt.verify(token, config.jwt.secret) as { exp: number; iat: number };
    expect(claims.exp - claims.iat).toBe(TILL_SESSION_MAX_AGE);
    expect(expiresIn).toBe(`${TILL_SESSION_MAX_AGE}s`);
  });

  it('reports the lifetime it actually signed, on the default path', () => {
    // The bug this guards: the client once assumed a 7-day lifetime while the
    // server signed for 24h, leaving it on a dead token for six days.
    const { token, expiresIn } = mintSession({ user });

    const claims = jwt.verify(token, config.jwt.secret) as { exp: number; iat: number };
    expect(expiresIn).toBe(config.jwt.expiresIn);
    expect(claims.exp - claims.iat).toBeGreaterThan(0);
  });
});
