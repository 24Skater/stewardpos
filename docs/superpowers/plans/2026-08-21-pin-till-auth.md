# PIN Till Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the password screen the back-office door and a paired terminal the till door, so a cashier signs on with a PIN instead of an email and password.

**Architecture:** A new `POST /api/auth/till` exchanges a terminal's `X-Register-Token` for an ordinary JWT. When the register has `requireSignIn`, the body carries a PIN and the session is the cashier it resolves to; otherwise the session is the register itself. The JWT carries `shiftId` (or `registerId`), and `authenticate` rejects it once that shift closes, so sign-out and idle timeout end the session. An admin can bypass pairing through an audited, time-boxed `POST /api/auth/till/assume`.

**Tech Stack:** Express 4, `jsonwebtoken`, Zod, Postgres + SQLite adapters, Vitest + Supertest (backend), React 18 + React Router 6 + TanStack Query, Vitest + Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-08-21-pin-till-auth-design.md`

---

## Before you start

Read these three files completely. Every task below assumes you know them:

- `backend/src/api/middleware/auth.ts` — `authenticate`, `TokenClaims`, the API-key path
- `backend/src/api/middleware/registerAuth.ts` — `requireRegisterToken`, which sets `req.tokenRegister`
- `backend/src/services/registerShifts.ts` — `startShift`, `getOpenShift`, `endShift`

**Two things that will bite you if you skip them:**

1. `POST /api/registers/:id/shifts` (`backend/src/api/routes/registers.ts:209`) already does everything the PIN half of this needs *except* mint a token. Do not rewrite its logic. Call `startShift` the same way it does.
2. Error codes are already defined in `backend/src/api/middleware/registerErrorCodes.ts` as `PIN_INVALID` and `PIN_LOCKED`. The spec prose says "BAD_PIN"; **the code constants win.** Use `PIN_INVALID`.

**Running things:**

```bash
# Backend tests (from repo root)
cd backend && npx vitest run src/api/routes/__tests__/<file>.test.ts

# Frontend tests (from repo root)
npx vitest run src/<path>/<file>.test.tsx

# Typecheck
npx tsc -p tsconfig.app.json --noEmit          # frontend
cd backend && npx tsc --noEmit                  # backend
```

Integration tests under `backend/src/adapters/db/__tests__/integration/` refuse to run unless the database is named `test`. They fail locally by design and run in CI. That is pre-existing — do not try to fix it.

---

## File Structure

**Backend — created**

| File | Responsibility |
|---|---|
| `backend/src/services/tillSessions.ts` | Minting till JWTs and resolving their claims. The one place a till session is created. |
| `backend/src/api/routes/till.ts` | `POST /api/auth/till` and `POST /api/auth/till/assume`. Thin handlers over the service. |
| `backend/src/api/routes/__tests__/tillAuth.test.ts` | Route tests for both endpoints. |
| `backend/src/api/routes/__tests__/loginPolicy.test.ts` | Tests for cashiers being refused the password form. |
| `backend/migrations/postgres/020_shift_emulation.sql` | `emulated_user_id` on `register_shifts`. |
| `backend/migrations/sqlite/020_shift_emulation.sql` | Same, for SQLite. |

**Backend — modified**

| File | Change |
|---|---|
| `backend/src/api/middleware/auth.ts` | `TokenClaims` gains `shiftId`/`registerId`; `authenticate` validates them. |
| `backend/src/api/routes/auth.ts` | Login refuses standard-only users; mounts the till router. |
| `backend/src/api/routes/admin.ts` | `POST /users/:id/pin/unlock`. |
| `backend/src/services/registerShifts.ts` | `startShift` accepts an optional `emulatedUserId`. |
| `backend/src/adapters/db/{Postgres,SQLite}Adapter.ts` | `createRegisterShift` persists `emulated_user_id`. |
| `backend/scripts/seed.ts` (or wherever the admin user is seeded) | Seed a PIN. |

**Frontend — created**

| File | Responsibility |
|---|---|
| `src/components/RequireTill.tsx` | The `/pos` gate: paired? session? assumed? |
| `src/components/register/ActingAsBanner.tsx` | The persistent banner during an assumed session. |
| `src/components/__tests__/RequireTill.test.tsx` | Gate tests. |

**Frontend — modified**

| File | Change |
|---|---|
| `src/lib/api/auth.ts` | `till()`, `assumeTill()` SDK methods. |
| `src/lib/api/admin.ts` | `unlockPin()`. |
| `src/lib/auth-store.ts` | `readAssumedSession()` / `writeAssumedSession()`, cleared with the token. |
| `src/pages/admin/AdminRegisters.tsx` | "Open this register" — the only entry point to `assume`. |
| `src/App.tsx` | `/` and `/pos` use `RequireTill`. |
| `src/components/register/LockScreen.tsx` | Calls `authApi.till()` instead of the shift endpoint. |
| `src/pages/Login.tsx` | Renders the `USE_PIN_AT_TILL` message. |
| `src/components/admin/CashierPinManager.tsx` | Lock state + unlock button. |
| `src/pages/POS.tsx` | Admin button gated on permission; sign-out returns to the pad. |

---

## Task 1: Extract session minting

`POST /api/auth/login` builds its JWT inline (`backend/src/api/routes/auth.ts:57-68`). Three endpoints will need to mint tokens. Extract it once so the claim shape cannot drift between them.

**Files:**
- Create: `backend/src/services/tillSessions.ts`
- Create: `backend/src/services/__tests__/tillSessions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/__tests__/tillSessions.test.ts
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
    expect(claims.shiftId).toBeUndefined();
    expect(claims.registerId).toBeUndefined();
  });

  it('carries the shift it was opened for', () => {
    const { token } = mintSession({ user, shiftId: 's1', registerId: 'reg1' });

    const claims = jwt.verify(token, config.jwt.secret) as Record<string, unknown>;
    expect(claims.shiftId).toBe('s1');
    expect(claims.registerId).toBe('reg1');
  });

  it('caps an assumed session at 30 minutes regardless of the configured lifetime', () => {
    // A forgotten assumed session must close itself; see the spec's Risks.
    const { token, expiresIn } = mintSession({ user, registerId: 'reg1', maxAgeSeconds: TILL_SESSION_MAX_AGE });

    const claims = jwt.verify(token, config.jwt.secret) as { exp: number; iat: number };
    expect(claims.exp - claims.iat).toBe(TILL_SESSION_MAX_AGE);
    expect(expiresIn).toBe(`${TILL_SESSION_MAX_AGE}s`);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/services/__tests__/tillSessions.test.ts`
Expected: FAIL — `Cannot find module '../../services/tillSessions'`

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/services/tillSessions.ts
import jwt from 'jsonwebtoken';
import config from '../config';
import { DEFAULT_ORG_ID } from '../api/middleware/auth';

/**
 * How long an assumed session lives, in seconds.
 *
 * An assumed session bypasses device pairing, so unlike a real till session it
 * is not bounded by someone walking away from a physical terminal. Thirty
 * minutes means a forgotten one closes itself.
 */
export const TILL_SESSION_MAX_AGE = 30 * 60;

export interface SessionUser {
  id: string;
  email: string;
  roleIds: string[];
  orgId?: string;
}

export interface MintSessionInput {
  user: SessionUser;
  /** Present on a PIN session: binds the token's life to the shift's. */
  shiftId?: string;
  /** Present on any till session, including a no-PIN one that has no shift. */
  registerId?: string;
  /** Overrides `config.jwt.expiresIn`. Used only by `assume`. */
  maxAgeSeconds?: number;
}

/**
 * Mint a session token.
 *
 * The single place a JWT is created, so the claim shape cannot drift between
 * the password login, a till sign-on, and an assumed session — `authenticate`
 * reads all three through one `TokenClaims` type.
 *
 * `shiftId` and `registerId` are omitted rather than set to null when absent:
 * `authenticate` branches on their presence, and a null would read as present.
 */
export function mintSession(input: MintSessionInput): { token: string; expiresIn: string } {
  const expiresIn = input.maxAgeSeconds ? `${input.maxAgeSeconds}s` : config.jwt.expiresIn;

  const token = jwt.sign(
    {
      id: input.user.id,
      email: input.user.email,
      roleIds: input.user.roleIds,
      orgId: input.user.orgId ?? DEFAULT_ORG_ID,
      ...(input.shiftId ? { shiftId: input.shiftId } : {}),
      ...(input.registerId ? { registerId: input.registerId } : {}),
    },
    config.jwt.secret,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { expiresIn } as any
  );

  return { token, expiresIn };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npx vitest run src/services/__tests__/tillSessions.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Point login at it**

In `backend/src/api/routes/auth.ts`, replace lines 55-68 (the `// Generate JWT token` comment through the closing `);` of `jwt.sign`) with:

```ts
    const { token, expiresIn } = mintSession({
      user: {
        id: String(user.id),
        email: String(user.email),
        roleIds: (user.roleIds as string[]) ?? [],
        orgId: user.orgId as string | undefined,
      },
    });
```

Then change the response body's `expiresIn: config.jwt.expiresIn` to `expiresIn`, and add to the imports at the top:

```ts
import { mintSession } from '../../services/tillSessions';
```

Remove the now-unused `import jwt from 'jsonwebtoken';` if nothing else in the file uses it.

- [ ] **Step 6: Verify login still works**

Run: `cd backend && npx vitest run src/api/routes/__tests__/ && npx tsc --noEmit`
Expected: PASS, no type errors

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/tillSessions.ts backend/src/services/__tests__/tillSessions.test.ts backend/src/api/routes/auth.ts
git commit -m "refactor(auth): mint session tokens in one place

Three endpoints will need to sign a JWT. Extracting it now means the
claim shape cannot drift between them, since authenticate reads all
three through a single TokenClaims type."
```

---

## Task 2: `authenticate` validates shift-bound sessions

A token carrying `shiftId` must stop working the moment that shift closes. Route the check through `getOpenShift`, which is the one place lazy idle expiry lives.

**Files:**
- Modify: `backend/src/api/middleware/auth.ts` (the `TokenClaims` interface at :60, and `authenticate` at :168)
- Create: `backend/src/api/middleware/__tests__/shiftBoundSession.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/api/middleware/__tests__/shiftBoundSession.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const getUserByEmail = vi.fn();
const getOpenShiftForRegister = vi.fn();
const getRegisterById = vi.fn();
const endRegisterShift = vi.fn();
const getRegisterShiftById = vi.fn();

vi.mock('../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getOpenShiftForRegister,
      getRegisterById,
      endRegisterShift,
      getRegisterShiftById,
      getAllProducts: vi.fn(async () => []),
    }),
  },
}));

const { default: app } = await import('../../app');
const { mintSession } = await import('../../services/tillSessions');

const USER = {
  id: 'u1',
  email: 'cashier@demo.local',
  name: 'Cashier',
  status: 'active',
  orgId: '00000000-0000-0000-0000-000000000001',
  roleIds: ['r1'],
  roles: [{ id: 'r1', name: 'Standard', systemRole: 'standard', permissions: { inventory: { read: true } } }],
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(USER);
  getRegisterById.mockResolvedValue({ id: 'reg1', status: 'active', idleLockSeconds: 300, orgId: USER.orgId });
});

/** Any authenticated GET will do; this one needs only `inventory:read`. */
const PROBE = '/api/products';

describe('a shift-bound session', () => {
  it('authorizes a request while its shift is open', async () => {
    getRegisterShiftById.mockResolvedValue({
      id: 's1', registerId: 'reg1', userId: 'u1', endedAt: null, lastActivityAt: Date.now(),
    });
    const { token } = mintSession({ user: USER, shiftId: 's1', registerId: 'reg1' });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it('is refused once the shift has ended', async () => {
    // The whole point: signing out must not leave a working token behind.
    getRegisterShiftById.mockResolvedValue({
      id: 's1', registerId: 'reg1', userId: 'u1', endedAt: Date.now(), lastActivityAt: Date.now(),
    });
    const { token } = mintSession({ user: USER, shiftId: 's1', registerId: 'reg1' });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('SHIFT_ENDED');
  });

  it('is refused once the shift has been idle past the register window', async () => {
    // No explicit end call: idle expiry is decided lazily on read.
    getRegisterShiftById.mockResolvedValue({
      id: 's1', registerId: 'reg1', userId: 'u1', endedAt: null,
      lastActivityAt: Date.now() - 400_000, // 400s > the register's 300s
    });
    const { token } = mintSession({ user: USER, shiftId: 's1', registerId: 'reg1' });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('SHIFT_ENDED');
  });

  it('is refused when the shift no longer exists', async () => {
    getRegisterShiftById.mockResolvedValue(null);
    const { token } = mintSession({ user: USER, shiftId: 's1', registerId: 'reg1' });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });
});

describe('a no-PIN till session', () => {
  it('authorizes while its register is active', async () => {
    const { token } = mintSession({ user: USER, registerId: 'reg1' });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(getRegisterShiftById).not.toHaveBeenCalled();
  });

  it('is refused once its register is no longer active', async () => {
    getRegisterById.mockResolvedValue({ id: 'reg1', status: 'retired', idleLockSeconds: 300, orgId: USER.orgId });
    const { token } = mintSession({ user: USER, registerId: 'reg1' });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });
});

describe('a password session', () => {
  it('takes none of the shift path', async () => {
    const { token } = mintSession({ user: USER });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(getRegisterShiftById).not.toHaveBeenCalled();
    expect(getRegisterById).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/api/middleware/__tests__/shiftBoundSession.test.ts`
Expected: FAIL — the ended-shift and idle cases return 200 instead of 401, because nothing checks the shift yet.

- [ ] **Step 3: Add the adapter method both adapters need**

`getOpenShift` looks a shift up *by register*. `authenticate` has a shift id, so it needs a by-id read. Add to `backend/src/adapters/db/PostgresAdapter.ts`, next to `getOpenShiftForRegister`:

```ts
  /**
   * One shift by id, open or closed.
   *
   * `getOpenShiftForRegister` answers "who is on this till"; session validation
   * asks the different question "is this specific shift still open", and must
   * see a closed row rather than null so it can tell "ended" from "never existed".
   */
  async getRegisterShiftById(shiftId: string): Promise<DbRow | null> {
    const { rows } = await this.query('SELECT * FROM register_shifts WHERE id = $1', [shiftId]);
    return rows[0] ? this.mapRegisterShift(rows[0]) : null;
  }
```

Add the identical method to `backend/src/adapters/db/SQLiteAdapter.ts`, using that file's own query style and its `mapRegisterShift` equivalent. Declare it on the `DatabaseAdapter` interface in `backend/src/services/database.ts`:

```ts
  getRegisterShiftById(shiftId: string): Promise<DbRow | null>;
```

- [ ] **Step 4: Extend the claims and the middleware**

In `backend/src/api/middleware/auth.ts`, replace the `TokenClaims` interface (:60-66) with:

```ts
/** What a session token carries, whichever endpoint minted it. */
interface TokenClaims {
  id: string;
  email: string;
  roleIds: string[];
  /** Absent in tokens minted before orgs existed; falls back to the default. */
  orgId?: string;
  /**
   * Present on a PIN till session. Binds the token to a shift: the session is
   * over when the shift is, so signing out or going idle cannot leave a working
   * token behind on a shared terminal.
   */
  shiftId?: string;
  /**
   * Present on any till session. On a no-PIN register there is no shift to bind
   * to, so the register's own status is what the session lives or dies by.
   */
  registerId?: string;
}
```

Add the import at the top of the same file:

```ts
import { getOpenShift } from '../../services/registerShifts';
```

Then, in `authenticate`, immediately after the `req.user = { ... }` assignment and before `next()`, insert:

```ts
    // A till session is only as alive as the thing that opened it. Checked
    // after `req.user` is built so the failure path is identical for every
    // caller, and skipped entirely for a password session, which carries
    // neither claim.
    if (claims.shiftId) {
      const shift = await db.getAdapter().getRegisterShiftById(claims.shiftId);
      // `getOpenShift` rather than reading `endedAt` here: it is the single
      // place idle expiry is decided, so a session and its shift can never
      // disagree about whether the cashier has walked away.
      const open = shift ? await getOpenShift(db.getAdapter(), String(shift.registerId)) : null;
      if (!open || String(open.id) !== claims.shiftId) {
        throw new AuthenticationError('That shift has ended', SHIFT_ENDED);
      }
    } else if (claims.registerId) {
      const register = await db.getAdapter().getRegisterById(claims.registerId);
      if (!register || register.status !== 'active') {
        throw new AuthenticationError('That register is no longer active', SHIFT_ENDED);
      }
    }
```

- [ ] **Step 5: Add the error code**

Append to `backend/src/api/middleware/registerErrorCodes.ts`:

```ts
/**
 * A till session outlived the shift that opened it — the cashier signed out,
 * went idle, was superseded, or the register was revoked. Distinguished from an
 * ordinary 401 so the terminal returns to its PIN pad rather than to the login
 * screen, which a cashier has no password for.
 */
export const SHIFT_ENDED = 'SHIFT_ENDED';
```

Import it in `auth.ts`:

```ts
import { SHIFT_ENDED } from './registerErrorCodes';
```

- [ ] **Step 6: Run it and watch it pass**

Run: `cd backend && npx vitest run src/api/middleware/__tests__/shiftBoundSession.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 7: Close the refresh hole**

**This is the most important step in the task.** `POST /api/auth/refresh`
(`backend/src/api/routes/auth.ts`) is `authenticate`d and re-signs a token from
`req.user`, which carries only `{ id, email, roleIds, orgId }`. It therefore
**drops `shiftId`** — so a till session could be exchanged for one with no shift
binding at all, immune to sign-out and idle timeout and lasting the full
configured lifetime. `auth-store.ts` auto-refreshes every minute, so this would
happen by itself, without anyone trying.

First, make the claims reachable. In `backend/src/api/middleware/auth.ts`, add to
`AuthRequest`:

```ts
  /**
   * The till session behind this request, when it is one.
   *
   * `req.user` says who; this says which shift and till they are on. `/refresh`
   * needs it to carry the binding forward — a refreshed token that dropped it
   * would be a till session laundered into one that never ends.
   */
  tillSession?: { shiftId?: string; registerId?: string };
```

and set it inside `authenticate`, right where the shift check runs:

```ts
    if (claims.shiftId || claims.registerId) {
      req.tillSession = { shiftId: claims.shiftId, registerId: claims.registerId };
    }
```

Then in the `/refresh` handler, replace the inline `jwt.sign(...)` with:

```ts
    // The binding is carried forward, never dropped. `authenticate` has already
    // confirmed the shift is still open, so re-minting with the same shiftId is
    // safe; minting WITHOUT it would hand back a token that outlives the shift.
    const { token, expiresIn } = mintSession({
      user: {
        id: req.user.id,
        email: req.user.email,
        roleIds: req.user.roleIds,
        orgId: req.orgId ?? DEFAULT_ORG_ID,
      },
      shiftId: req.tillSession?.shiftId,
      registerId: req.tillSession?.registerId,
    });
```

and return `expiresIn` from it rather than `config.jwt.expiresIn`.

Add these tests to `shiftBoundSession.test.ts`:

```ts
describe('POST /api/auth/refresh', () => {
  it('carries the shift binding into the refreshed token', async () => {
    // Without this, refresh launders a till session into one that never ends —
    // and auth-store refreshes on a timer, so it would happen unprompted.
    getRegisterShiftById.mockResolvedValue({
      id: 's1', registerId: 'reg1', userId: 'u1', endedAt: null, lastActivityAt: Date.now(),
    });
    const { token } = mintSession({ user: USER, shiftId: 's1', registerId: 'reg1' });

    const response = await request(app).post('/api/auth/refresh').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const [, payload] = String(response.body.data.token).split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString());
    expect(claims.shiftId).toBe('s1');
    expect(claims.registerId).toBe('reg1');
  });

  it('refuses to refresh a session whose shift has ended', async () => {
    getRegisterShiftById.mockResolvedValue({
      id: 's1', registerId: 'reg1', userId: 'u1', endedAt: Date.now(), lastActivityAt: Date.now(),
    });
    const { token } = mintSession({ user: USER, shiftId: 's1', registerId: 'reg1' });

    const response = await request(app).post('/api/auth/refresh').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });

  it('leaves a password session unbound', async () => {
    const { token } = mintSession({ user: USER });

    const response = await request(app).post('/api/auth/refresh').set('Authorization', `Bearer ${token}`);

    const [, payload] = String(response.body.data.token).split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString());
    expect(claims.shiftId).toBeUndefined();
  });
});
```

- [ ] **Step 8: Verify nothing else regressed**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: the same 25 integration files fail on the database-name guard as before; every other file passes. Confirm the passing test count went **up**, not down.

- [ ] **Step 9: Commit**

```bash
git add backend/src/api/middleware/ backend/src/adapters/db/ backend/src/services/database.ts backend/src/api/middleware/__tests__/shiftBoundSession.test.ts
git commit -m "feat(auth): end the session when the shift ends

A till session carries the shift that opened it, and authenticate
resolves that shift through getOpenShift — the one place lazy idle
expiry is decided — so signing out, going idle, being superseded and
having the register revoked all end the session on its next request.

Password sessions carry no shiftId and take none of this path."
```

---

## Task 2b: Close the gaps a security review found in Task 2

Task 2 shipped a mechanism that is right in shape and wrong in four specifics.
Each of these was asserted to work — in the commit message, in a doc comment, or
in the spec — and does not.

**Files:**
- Modify: `backend/src/api/middleware/auth.ts`
- Modify: `backend/src/services/registerEnrolment.ts`, `backend/src/services/registers.ts`
- Modify: `backend/src/services/tillSessions.ts`, `backend/src/api/routes/auth.ts`
- Modify: `backend/src/api/middleware/__tests__/shiftBoundSession.test.ts`

- [ ] **Fix 1 (CRITICAL): revoking a register must end its shift**

The spec claims revoke kills the session. It does not. `revokeCredential`,
`retireRegister` and `disableRegister` never touch the shift row, and the
`shiftId` branch of `authenticate` never reads register status — the `else if`
skips the branch that would, because a PIN session carries **both** claims.
`EndShiftReason` declares `'revoked'` and `'forced'` and neither string is passed
to `endShift` anywhere in the repo, which is the tell.

Fix it in both places, because either alone leaves a gap:

*Defence one* — in `authenticate`, check the register for a PIN session too.
Change the `else if` to validate both claims:

```ts
    // Both claims are validated, not one. A PIN session carries both, and the
    // register half is what makes a revoked till stop working: ending the shift
    // on revoke (below) is the primary defence, but a shift that somehow
    // outlives its register must not keep authorizing either.
    if (claims.shiftId) {
      const shift = await db.getAdapter().getRegisterShiftById(claims.shiftId);
      const open = shift ? await getOpenShift(db.getAdapter(), String(shift.registerId)) : null;
      if (!open || String(open.id) !== claims.shiftId) {
        throw new AuthenticationError('That shift has ended', SHIFT_ENDED);
      }
      // The token's register must be the shift's. Nothing else asserts this,
      // and `/refresh` copies registerId forward into every future token.
      if (claims.registerId && String(open.registerId) !== claims.registerId) {
        throw new AuthenticationError('That shift has ended', SHIFT_ENDED);
      }
    }

    const boundRegisterId = claims.registerId ?? null;
    if (boundRegisterId) {
      const register = await db.getAdapter().getRegisterById(boundRegisterId);
      if (!register || register.status !== 'active') {
        throw new AuthenticationError('That register is no longer active', REGISTER_INACTIVE);
      }
    }
```

Add `REGISTER_INACTIVE` to `registerErrorCodes.ts` — a client's recovery differs
("this till was decommissioned" is not "PIN again"), and one code for both was
flagged as indistinguishable when it should not be.

*Defence two* — end open shifts where status changes. In
`backend/src/services/registers.ts`, `retireRegister` and `disableRegister` must
end any open shift with reason `'forced'`; in `registerEnrolment.ts`,
`revokeCredential` must end it with `'revoked'`. Those two reasons exist in
`EndShiftReason` and migration 018 precisely for this and have never been used.

- [ ] **Fix 2: bump the idle clock on every till request**

`touchShift` is called from two places only — `orders.ts` checkout and
`returns.ts`. Migration 018 says twice that "every authenticated action on this
register bumps it"; that was never true, and became load-bearing the moment
Task 2 made `authenticate` enforce idle expiry on every request. A cashier
scanning a large basket for over `idleLockSeconds` (default 300) is thrown out
mid-sale.

In `authenticate`, after the shift is confirmed open:

```ts
      // Migration 018 says every authenticated action bumps this; until now
      // only checkout and returns did, so a cashier scanning a large basket
      // was thrown out mid-sale. Throttled because this is a write on the
      // request path: a bump is worthless more often than once every 30s,
      // and the idle window is measured in minutes.
      const sinceActivity = Date.now() - Number(open.lastActivityAt);
      if (sinceActivity > ACTIVITY_BUMP_THROTTLE_MS) {
        await touchShift(db.getAdapter(), claims.shiftId);
      }
```

with `const ACTIVITY_BUMP_THROTTLE_MS = 30_000;` and `touchShift` imported from
`registerShifts`. Leave the two existing `touchShift` calls alone — they are
harmless and the throttle absorbs them.

- [ ] **Fix 3: an assumed session cannot be refreshed**

`/refresh` re-mints at `config.jwt.expiresIn`, dropping `maxAgeSeconds`. When
Task 7's `assume` lands, the first auto-refresh — which fires on a 60-second
timer — erases its 30-minute cap. A cap that can be refreshed is not a cap.

Add an `assumed` claim in `tillSessions.ts` (`MintSessionInput.assumed?: boolean`,
emitted with the same omit-when-absent spread as the other optional claims), read
it in `TokenClaims`, and in `/refresh`:

```ts
    // An assumed session is capped at TILL_SESSION_MAX_AGE precisely because it
    // bypassed device pairing. Re-minting it would let a 30-minute grant be held
    // open indefinitely by the client's own refresh timer, so it is refused and
    // the admin assumes the till again.
    if (req.tillSession?.assumed) {
      throw new AuthenticationError('An assumed till session cannot be extended', SHIFT_ENDED);
    }
```

Carry `assumed` on `req.tillSession` alongside `shiftId`/`registerId`.

- [ ] **Fix 4: tests for all of the above**

Add to `shiftBoundSession.test.ts`: a PIN session on a non-`active` register is
refused with `REGISTER_INACTIVE` (this is the case that would have caught the
critical bug); a token whose `registerId` disagrees with its shift's register is
refused; an active shift older than the throttle bumps `touchShift` and one
newer than it does not; an assumed session is refused at `/refresh` while an
ordinary PIN session is not.

- [ ] **Deferred to the frontend phase — do NOT do it here**

`SHIFT_ENDED` has no client half. `src/lib/api-client.ts` special-cases only
`REGISTER_TOKEN_INVALID`; every other 401 clears the token and hard-navigates to
`/login`, so a shift ending strands a cashier at a password prompt — exactly what
the code's own comment says it prevents. **Task 10 must handle `SHIFT_ENDED` and
`REGISTER_INACTIVE`**: the first returns to the PIN pad, the second to `/pair`.

---

## Task 3: `POST /api/auth/till`

**Files:**
- Create: `backend/src/api/routes/till.ts`
- Create: `backend/src/api/routes/__tests__/tillAuth.test.ts`
- Modify: `backend/src/api/routes/auth.ts` (mount the router)

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/api/routes/__tests__/tillAuth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

const getRegisterById = vi.fn();
const getActiveUsersWithPin = vi.fn();
const getUserById = vi.fn();
const getUserByEmail = vi.fn();
const getOpenShiftForRegister = vi.fn();
const endRegisterShift = vi.fn();
const createRegisterShift = vi.fn();
const resetPinFailures = vi.fn();
const recordPinFailure = vi.fn();
const createAuditLog = vi.fn();
const getRegisterCredentialByPrefix = vi.fn();

vi.mock('../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getRegisterById, getActiveUsersWithPin, getUserById, getUserByEmail,
      getOpenShiftForRegister, endRegisterShift, createRegisterShift,
      resetPinFailures, recordPinFailure, createAuditLog,
      getRegisterCredentialByPrefix,
    }),
  },
}));

/**
 * The device credential is stubbed at the verification boundary rather than by
 * forging a token: what is under test is the endpoint's behaviour once the
 * terminal is known, not the pairing crypto, which registerEnrolment owns and
 * tests itself.
 */
const verifyDeviceToken = vi.fn();
vi.mock('../../services/registerEnrolment', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, verifyDeviceToken };
});

const { default: app } = await import('../../app');

const ORG = '00000000-0000-0000-0000-000000000001';
const PIN = '4821';
const CASHIER = {
  id: 'u1', email: 'cashier@demo.local', name: 'Cashier', status: 'active', orgId: ORG,
  roleIds: ['r1'], roles: [{ id: 'r1', name: 'Standard', systemRole: 'standard' }],
  pinHash: bcrypt.hashSync(PIN, 4), pinLockedUntil: null, pinFailedCount: 0,
};

function register(overrides: Record<string, unknown> = {}) {
  return { id: 'reg1', orgId: ORG, status: 'active', requireSignIn: true, idleLockSeconds: 300, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyDeviceToken.mockResolvedValue({ register: register() });
  getRegisterById.mockResolvedValue(register());
  getActiveUsersWithPin.mockResolvedValue([CASHIER]);
  getUserById.mockResolvedValue(CASHIER);
  getUserByEmail.mockResolvedValue(CASHIER);
  getOpenShiftForRegister.mockResolvedValue(null);
  createRegisterShift.mockResolvedValue({ id: 's1', registerId: 'reg1', userId: 'u1', endedAt: null, lastActivityAt: Date.now() });
});

const till = () => request(app).post('/api/auth/till').set('X-Register-Token', 'rt_device');

describe('POST /api/auth/till on a sign-in register', () => {
  it('mints a session for the cashier whose PIN it is', async () => {
    const response = await till().send({ pin: PIN });

    expect(response.status).toBe(201);
    expect(response.body.data.token).toEqual(expect.any(String));
    expect(response.body.data.user.id).toBe('u1');
    expect(response.body.data.shift.id).toBe('s1');
  });

  it('binds the token to the shift it just opened', async () => {
    const response = await till().send({ pin: PIN });

    const [, payload] = String(response.body.data.token).split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString());
    expect(claims.shiftId).toBe('s1');
    expect(claims.registerId).toBe('reg1');
  });

  it('refuses a PIN that matches nobody', async () => {
    const response = await till().send({ pin: '0000' });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('PIN_INVALID');
    expect(createRegisterShift).not.toHaveBeenCalled();
  });

  it('refuses a locked account distinctly, so the pad can stop asking', async () => {
    getActiveUsersWithPin.mockResolvedValue([{ ...CASHIER, pinLockedUntil: Date.now() + 60_000 }]);
    getUserById.mockResolvedValue({ ...CASHIER, pinLockedUntil: Date.now() + 60_000 });

    const response = await till().send({ pin: PIN });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('PIN_LOCKED');
  });

  it('requires a PIN', async () => {
    const response = await till().send({});

    expect(response.status).toBe(400);
  });
});

describe('POST /api/auth/till on a register that does not require sign-in', () => {
  beforeEach(() => {
    verifyDeviceToken.mockResolvedValue({ register: register({ requireSignIn: false }) });
    getRegisterById.mockResolvedValue(register({ requireSignIn: false }));
  });

  it('mints a session from the device token alone', async () => {
    const response = await till().send({});

    expect(response.status).toBe(201);
    expect(response.body.data.token).toEqual(expect.any(String));
    expect(response.body.data.shift).toBeNull();
    expect(createRegisterShift).not.toHaveBeenCalled();
  });

  it('refuses a PIN rather than ignoring it', async () => {
    // Accepting a parameter and doing nothing with it invites the caller to
    // believe it took effect — the same reason registerHourlySchema omits the
    // filters it cannot honour.
    const response = await till().send({ pin: PIN });

    expect(response.status).toBe(400);
  });
});

describe('POST /api/auth/till device binding', () => {
  it('is refused with no device token at all', async () => {
    const response = await request(app).post('/api/auth/till').send({ pin: PIN });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('REGISTER_TOKEN_INVALID');
    expect(createRegisterShift).not.toHaveBeenCalled();
  });

  it('is refused when the device token is revoked', async () => {
    verifyDeviceToken.mockResolvedValue('revoked');

    const response = await till().send({ pin: PIN });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('REGISTER_TOKEN_INVALID');
  });

  it('takes the register from the token, never from the body', async () => {
    // A client must not be able to open a session at a till it is not at.
    await till().send({ pin: PIN, registerId: 'someone-elses-register' });

    expect(createRegisterShift).toHaveBeenCalledWith(expect.objectContaining({ registerId: 'reg1' }));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/api/routes/__tests__/tillAuth.test.ts`
Expected: FAIL — every case 404s; the route does not exist.

- [ ] **Step 3: Write the route**

```ts
// backend/src/api/routes/till.ts
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import logger from '../../utils/logger';
import db from '../../services/database';
import { audit } from '../../utils/audit';
import { AuthenticationError, ValidationError, NotFoundError, UnprocessableEntityError } from '../../utils/errors';
import { requireRegisterToken, AuthenticatedRegisterRequest } from '../middleware/registerAuth';
import { PIN_INVALID, PIN_LOCKED } from '../middleware/registerErrorCodes';
import { startShift } from '../../services/registerShifts';
import { mintSession } from '../../services/tillSessions';

/**
 * Till sessions.
 *
 * `POST /api/registers/:id/shifts` opens a shift and deliberately returns no
 * token — a PIN sign-on was not a session when it was written. This is the
 * endpoint that makes it one, so a cashier can reach the register without a
 * password. It reuses `startShift` rather than reimplementing the PIN scan, and
 * `requireRegisterToken` rather than trusting a register id from the body: the
 * register is whichever one the device credential proves the caller to be.
 */
const router = Router();

/**
 * `.strict()` on purpose. A `registerId` in the body is not merely ignored, it
 * is a 400 — a caller sending one believes it selects the till, and silently
 * using a different register than the one they named is worse than refusing.
 */
const tillSchema = z.object({ pin: z.string().trim().min(1).optional() }).strict();

router.post(
  '/',
  requireRegisterToken,
  async (req: AuthenticatedRegisterRequest, res: Response, next: NextFunction) => {
    try {
      const body = tillSchema.parse(req.body ?? {});
      const register = req.tokenRegister as Record<string, unknown>;
      const registerId = String(register.id);
      const requiresPin = Boolean(register.requireSignIn);

      if (requiresPin && !body.pin) {
        throw new ValidationError('A PIN is required at this register');
      }
      if (!requiresPin && body.pin) {
        throw new ValidationError('This register does not use PIN sign-in');
      }

      // No-PIN: the device credential is the whole of the authentication, and
      // there is no cashier to name. Sales land in the `unknown` bucket that
      // `sales-by-cashier` already reports, exactly as they do today on a
      // register with sign-in off.
      if (!requiresPin) {
        const { token, expiresIn } = mintSession({
          user: {
            id: `register:${registerId}`,
            email: `register:${registerId}`,
            roleIds: [],
            orgId: String(register.orgId),
          },
          registerId,
        });

        logger.info(`Till session opened on register ${registerId} without sign-in`);
        res.status(201).json({
          success: true,
          data: { token, expiresIn, register: { id: registerId }, user: null, shift: null },
        });
        return;
      }

      const adapter = db.getAdapter();
      const result = await startShift(adapter, { registerId, pin: body.pin as string });

      if (result === 'register_not_found') throw new NotFoundError('Register');
      if (result === 'register_not_active') throw new UnprocessableEntityError('This register is not active');
      if (result === 'bad_pin') throw new AuthenticationError('That PIN was not recognized', PIN_INVALID);
      if (result === 'locked') {
        throw new AuthenticationError(
          'This PIN is locked after too many failed attempts. Try again later.',
          PIN_LOCKED
        );
      }

      const { token, expiresIn } = mintSession({
        user: {
          id: String(result.user.id),
          email: String(result.user.email),
          roleIds: (result.user.roleIds as string[]) ?? [],
          orgId: String(result.user.orgId ?? register.orgId),
        },
        shiftId: String(result.shift.id),
        registerId,
      });

      logger.info(`Till session opened on register ${registerId} for user ${result.user.id}`);
      await audit(req, {
        action: 'create',
        entity: 'register_shift',
        entityId: String(result.shift.id),
        after: { registerId, userId: result.user.id, supersededShiftId: result.supersededShiftId },
      });

      res.status(201).json({
        success: true,
        data: {
          token,
          expiresIn,
          register: { id: registerId },
          user: { id: result.user.id, name: result.user.name, email: result.user.email },
          shift: result.shift,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError(error.errors[0].message));
        return;
      }
      next(error);
    }
  }
);

export default router;
```

- [ ] **Step 4: Mount it, rate-limited**

`backend/src/api/routes/registers.ts:67` defines a `shiftLimiter` for exactly this kind of endpoint. Export it from there:

```ts
export const shiftLimiter = rateLimit({ /* the existing options, unchanged */ });
```

In `backend/src/api/routes/auth.ts`, add near the top:

```ts
import tillRouter from './till';
import { shiftLimiter } from './registers';
```

and after the login route:

```ts
// Brute-force protection in front of a short PIN, the same limiter the
// existing shift endpoint uses.
router.use('/till', shiftLimiter, tillRouter);
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd backend && npx vitest run src/api/routes/__tests__/tillAuth.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 6: Commit**

```bash
git add backend/src/api/routes/till.ts backend/src/api/routes/auth.ts backend/src/api/routes/registers.ts backend/src/api/routes/__tests__/tillAuth.test.ts
git commit -m "feat(auth): exchange a device token for a till session

A paired terminal posts its register token and, where the register
requires sign-in, a PIN. The register is whichever one the credential
proves the caller to be, never one named in the body.

A register with sign-in off mints a session from the device token alone
and keeps attributing to the unknown cashier bucket that already exists."
```

---

## Task 4: Login refuses cashiers

**Files:**
- Modify: `backend/src/api/routes/auth.ts` (after the `status !== 'active'` check)
- Create: `backend/src/api/routes/__tests__/loginPolicy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/api/routes/__tests__/loginPolicy.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

const getUserByEmail = vi.fn();
const updateUserLastLogin = vi.fn();

vi.mock('../../services/database', () => ({
  default: { getAdapter: () => ({ getUserByEmail, updateUserLastLogin }) },
}));

const { default: app } = await import('../../app');

const PASSWORD = 'DemoPass!1';
const HASH = bcrypt.hashSync(PASSWORD, 4);

function user(roles: { systemRole: string }[]) {
  return {
    id: 'u1', email: 'someone@demo.local', name: 'Someone', status: 'active',
    passwordHash: HASH, orgId: '00000000-0000-0000-0000-000000000001',
    roleIds: roles.map((_, i) => `r${i}`),
    roles: roles.map((role, i) => ({ id: `r${i}`, name: role.systemRole, ...role })),
  };
}

const login = () =>
  request(app).post('/api/auth/login').send({ email: 'someone@demo.local', password: PASSWORD });

beforeEach(() => {
  vi.clearAllMocks();
  updateUserLastLogin.mockResolvedValue(undefined);
});

describe('who the password form accepts', () => {
  it.each([['admin'], ['supervisor'], ['reporter']])(
    'accepts %s, who needs the back office',
    async (systemRole) => {
      getUserByEmail.mockResolvedValue(user([{ systemRole }]));

      const response = await login();

      expect(response.status).toBe(200);
      expect(response.body.data.token).toEqual(expect.any(String));
    }
  );

  it('refuses a cashier and tells them where to go', async () => {
    getUserByEmail.mockResolvedValue(user([{ systemRole: 'standard' }]));

    const response = await login();

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('USE_PIN_AT_TILL');
    expect(response.body.error).toMatch(/PIN/i);
  });

  it('accepts someone who is a cashier AND a reporter', async () => {
    // "All standard" is the test, not "any standard": a second role that needs
    // the back office is a reason to let them in.
    getUserByEmail.mockResolvedValue(user([{ systemRole: 'standard' }, { systemRole: 'reporter' }]));

    const response = await login();

    expect(response.status).toBe(200);
  });

  it('refuses a user with no roles at all', async () => {
    getUserByEmail.mockResolvedValue(user([]));

    const response = await login();

    expect(response.status).toBe(403);
  });

  it('checks the password before the role, so it is not a cashier oracle', async () => {
    // Refusing on role first would let anyone discover which addresses belong
    // to cashiers without knowing a single password.
    getUserByEmail.mockResolvedValue(user([{ systemRole: 'standard' }]));

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'someone@demo.local', password: 'wrong' });

    expect(response.status).toBe(401);
    expect(response.body.code).not.toBe('USE_PIN_AT_TILL');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/api/routes/__tests__/loginPolicy.test.ts`
Expected: FAIL — the cashier cases return 200.

- [ ] **Step 3: Add the code and the check**

Append to `backend/src/api/middleware/registerErrorCodes.ts`:

```ts
/**
 * A user whose only role is a till role tried the password form. The password
 * was correct; the door is the wrong one. Distinguished so the login screen can
 * point them at the PIN pad instead of showing "invalid credentials", which
 * would be both wrong and unhelpful.
 */
export const USE_PIN_AT_TILL = 'USE_PIN_AT_TILL';
```

In `backend/src/api/routes/auth.ts`, add the imports:

```ts
import { ForbiddenError } from '../../utils/errors';
import { USE_PIN_AT_TILL } from '../middleware/registerErrorCodes';
```

and insert immediately after the `if (user.status !== 'active')` block:

```ts
    /**
     * The password form is the back-office door; the till has its own.
     *
     * Deliberately after the password comparison: refusing earlier would turn
     * this endpoint into an oracle for which addresses belong to cashiers.
     *
     * "Every role is `standard`" rather than "any role is `standard`" — a
     * cashier who is also a Reporter has back-office work to do, and a user
     * with no roles has no business here either way.
     */
    const roles = (user.roles as { systemRole?: string }[]) ?? [];
    const isTillOnly = roles.length === 0 || roles.every((role) => role.systemRole === 'standard');
    if (isTillOnly) {
      logger.info(`Refused password login for till-only user ${email}`);
      throw new ForbiddenError('Use your PIN at the till.', USE_PIN_AT_TILL);
    }
```

If `ForbiddenError` does not take a code as its second argument, check how `AuthenticationError` does it in `backend/src/utils/errors.ts` and match that signature.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npx vitest run src/api/routes/__tests__/loginPolicy.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Verify the whole backend**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: no new failures. **The seeded admin is `admin`, so existing tests that log in still pass.** If any test logs in as a standard-role user, update that test's fixture to a supervisor — do not weaken the check.

- [ ] **Step 6: Commit**

```bash
git add backend/src/api/routes/auth.ts backend/src/api/middleware/registerErrorCodes.ts backend/src/api/routes/__tests__/loginPolicy.test.ts
git commit -m "feat(auth): the password form is the back-office door

A user whose every role is standard is refused with USE_PIN_AT_TILL and
sent to the PIN pad. Checked after the password comparison so the
endpoint cannot be used to discover which addresses belong to cashiers."
```

---

## Task 5: Admins clear a PIN lockout

**Files:**
- Modify: `backend/src/api/routes/admin.ts` (beside the existing `PUT`/`DELETE /users/:id/pin` at :162 and :208)
- Create: `backend/src/api/routes/__tests__/pinUnlock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/api/routes/__tests__/pinUnlock.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const getUserById = vi.fn();
const getUserByEmail = vi.fn();
const resetPinFailures = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../services/database', () => ({
  default: { getAdapter: () => ({ getUserById, getUserByEmail, resetPinFailures, createAuditLog }) },
}));

const { default: app } = await import('../../app');
const { mintSession } = await import('../../services/tillSessions');

const ORG = '00000000-0000-0000-0000-000000000001';

function actor(canWriteUsers: boolean) {
  return {
    id: 'admin1', email: 'admin@demo.local', name: 'Admin', status: 'active', orgId: ORG,
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', permissions: { users: { read: true, write: canWriteUsers } } }],
  };
}

const LOCKED = {
  id: 'u1', email: 'cashier@demo.local', name: 'Cashier', orgId: ORG,
  pinSetAt: 1000, pinLockedUntil: Date.now() + 600_000, pinFailedCount: 5,
};

function tokenFor(canWriteUsers: boolean) {
  const user = actor(canWriteUsers);
  getUserByEmail.mockResolvedValue(user);
  return mintSession({ user }).token;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserById.mockResolvedValue(LOCKED);
  resetPinFailures.mockResolvedValue({ ...LOCKED, pinLockedUntil: null, pinFailedCount: 0 });
});

describe('POST /api/admin/users/:id/pin/unlock', () => {
  it('clears the lockout so the cashier need not wait it out', async () => {
    const response = await request(app)
      .post('/api/admin/users/u1/pin/unlock')
      .set('Authorization', `Bearer ${tokenFor(true)}`);

    expect(response.status).toBe(200);
    expect(resetPinFailures).toHaveBeenCalledWith('u1');
    expect(response.body.data.pinLockedUntil).toBeNull();
  });

  it('never returns the PIN hash', async () => {
    resetPinFailures.mockResolvedValue({ ...LOCKED, pinHash: 'SHOULD-NOT-LEAK', pinLockedUntil: null });

    const response = await request(app)
      .post('/api/admin/users/u1/pin/unlock')
      .set('Authorization', `Bearer ${tokenFor(true)}`);

    expect(JSON.stringify(response.body)).not.toContain('SHOULD-NOT-LEAK');
  });

  it('is audited', async () => {
    await request(app)
      .post('/api/admin/users/u1/pin/unlock')
      .set('Authorization', `Bearer ${tokenFor(true)}`);

    expect(createAuditLog).toHaveBeenCalled();
  });

  it('needs users:write', async () => {
    const response = await request(app)
      .post('/api/admin/users/u1/pin/unlock')
      .set('Authorization', `Bearer ${tokenFor(false)}`);

    expect(response.status).toBe(403);
    expect(resetPinFailures).not.toHaveBeenCalled();
  });

  it('404s for a user who does not exist', async () => {
    getUserById.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/admin/users/u1/pin/unlock')
      .set('Authorization', `Bearer ${tokenFor(true)}`);

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/api/routes/__tests__/pinUnlock.test.ts`
Expected: FAIL — 404 on every case.

- [ ] **Step 3: Write the route**

Add to `backend/src/api/routes/admin.ts`, directly after the `DELETE /users/:id/pin` handler. Match the exact response projection that handler returns — read it first and mirror it, so both endpoints hand the client the same shape.

```ts
/**
 * POST /api/admin/users/:id/pin/unlock
 *
 * Clear a PIN lockout without waiting out the fifteen minutes
 * (`services/pins.ts`). The lockout exists to blunt PIN guessing; a manager
 * standing next to the cashier has already answered the question it was asking,
 * and a shop cannot wait a quarter of an hour with a queue at the till.
 *
 * Does NOT change the PIN — the cashier's own PIN still works afterwards. Use
 * `PUT /users/:id/pin` for that.
 */
router.post('/users/:id/pin/unlock', requirePermission('users', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();

    const existing = await adapter.getUserById(id);
    if (!existing || String(existing.orgId) !== (req.orgId ?? DEFAULT_ORG_ID)) {
      throw new NotFoundError('User');
    }

    const updated = await adapter.resetPinFailures(id);

    logger.info(`PIN lockout cleared for user ${id} by ${req.user?.email}`);
    await audit(req, {
      action: 'update',
      entity: 'user_pin',
      entityId: id,
      before: { pinLockedUntil: existing.pinLockedUntil, pinFailedCount: existing.pinFailedCount },
      after: { pinLockedUntil: null, pinFailedCount: 0 },
    });

    res.json({
      success: true,
      data: {
        id: String(updated?.id ?? id),
        email: updated?.email ?? existing.email,
        name: updated?.name ?? existing.name,
        pinSetAt: updated?.pinSetAt ?? existing.pinSetAt ?? null,
        pinLockedUntil: null,
      },
    });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npx vitest run src/api/routes/__tests__/pinUnlock.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/routes/admin.ts backend/src/api/routes/__tests__/pinUnlock.test.ts
git commit -m "feat(admin): clear a PIN lockout without waiting it out

The fifteen-minute lockout blunts PIN guessing. A manager standing next
to the cashier has already answered that question, and a queue at the
till cannot wait a quarter of an hour. Does not change the PIN."
```

---

## Task 6: Shifts record an emulated cashier

`assume` needs somewhere to record who the admin was standing in for. Attribution stays on `user_id` — the admin — so every existing report keeps working untouched.

**Files:**
- Create: `backend/migrations/postgres/020_shift_emulation.sql`
- Create: `backend/migrations/sqlite/020_shift_emulation.sql`
- Modify: `backend/src/services/registerShifts.ts` (`StartShiftInput`, `startShift`)
- Modify: `backend/src/adapters/db/{Postgres,SQLite}Adapter.ts` (`createRegisterShift`, `mapRegisterShift`)

- [ ] **Step 1: Write the migration**

```sql
-- backend/migrations/postgres/020_shift_emulation.sql
-- Who an admin was standing in for, when they assumed a till.
--
-- An admin can open any register from a back-office browser to cover a break or
-- reproduce what a cashier sees. The sale is still attributed to the ADMIN via
-- user_id: sales-by-cashier, drawer-variance-by-register and no-sale-counts all
-- exist to answer "who was standing at this till", and an admin able to file
-- sales under someone else's name would make all three unable to settle the
-- disputes they were built for.
--
-- This column records the intent, so the audit trail shows whose shift was being
-- covered, without ever becoming the attributed identity. NULL on every ordinary
-- shift, which is all of them today.
ALTER TABLE register_shifts
  ADD COLUMN emulated_user_id UUID REFERENCES users(id);

COMMENT ON COLUMN register_shifts.emulated_user_id IS
  'Cashier an admin was standing in for. Never the attributed identity: see user_id.';
```

```sql
-- backend/migrations/sqlite/020_shift_emulation.sql
-- See the Postgres copy of this migration for why attribution stays on user_id.
ALTER TABLE register_shifts ADD COLUMN emulated_user_id TEXT REFERENCES users(id);
```

- [ ] **Step 2: Run the migrations**

```bash
docker compose exec -T postgres psql -U stewardpos_user -d stewardpos \
  -f /dev/stdin < backend/migrations/postgres/020_shift_emulation.sql
docker compose exec -T postgres psql -U stewardpos_user -d stewardpos -c "\d register_shifts"
```

Expected: `emulated_user_id | uuid` present in the column list.

- [ ] **Step 3: Thread it through the service**

In `backend/src/services/registerShifts.ts`, extend the input:

```ts
export interface StartShiftInput {
  registerId: string;
  pin: string;
  /**
   * Set only by `assume`. Recorded on the shift so the audit trail shows whose
   * till was being covered; it is never the attributed identity — see the 020
   * migration.
   */
  emulatedUserId?: string;
}
```

and pass it through at the `createRegisterShift` call near the end of `startShift`:

```ts
  const shift = await adapter.createRegisterShift({
    registerId: input.registerId,
    userId: String(user.id),
    emulatedUserId: input.emulatedUserId ?? null,
  });
```

- [ ] **Step 4: Persist it in both adapters**

In `PostgresAdapter.createRegisterShift`, add `emulated_user_id` to the INSERT column list and `payload.emulatedUserId ?? null` to the values. In `mapRegisterShift`, add:

```ts
      emulatedUserId: row.emulated_user_id ?? null,
```

Make the same two changes in `SQLiteAdapter`, following that file's own query style.

- [ ] **Step 5: Verify**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: no new failures. Existing shift tests still pass — the column is nullable and every current caller omits it.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/ backend/src/services/registerShifts.ts backend/src/adapters/db/
git commit -m "feat(shifts): record who an admin was standing in for

Nullable and unset on every shift that exists today. Attribution stays
on user_id so the cashier, drawer-variance and no-sale reports are
untouched; this column records intent, never identity."
```

---

## Task 7: `POST /api/auth/till/assume`

**Files:**
- Modify: `backend/src/api/routes/till.ts`
- Modify: `backend/src/api/routes/__tests__/tillAuth.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `backend/src/api/routes/__tests__/tillAuth.test.ts`. Add `mintSession` to the imports at the top of that file:

```ts
const { mintSession } = await import('../../services/tillSessions');
```

```ts
const ADMIN = {
  id: 'admin1', email: 'admin@demo.local', name: 'Admin', status: 'active', orgId: ORG,
  roleIds: ['ra'],
  roles: [{ id: 'ra', name: 'Admin', permissions: { registers: { read: true, write: true } } }],
};

const NO_WRITE = {
  ...ADMIN,
  roles: [{ id: 'ra', name: 'Viewer', permissions: { registers: { read: true, write: false } } }],
};

function adminToken(who = ADMIN) {
  getUserByEmail.mockResolvedValue(who);
  return mintSession({ user: who }).token;
}

describe('POST /api/auth/till/assume', () => {
  beforeEach(() => {
    getUserById.mockImplementation(async (id: string) => (id === 'u1' ? CASHIER : ADMIN));
  });

  it('mints a till session with no device token at all', async () => {
    const response = await request(app)
      .post('/api/auth/till/assume')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ registerId: 'reg1' });

    expect(response.status).toBe(201);
    expect(response.body.data.token).toEqual(expect.any(String));
  });

  it('attributes the shift to the admin, not the emulated cashier', async () => {
    // The point of the whole feature: an admin covering a till must not be able
    // to file sales under a cashier's name.
    await request(app)
      .post('/api/auth/till/assume')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ registerId: 'reg1', emulateUserId: 'u1' });

    expect(createRegisterShift).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin1', emulatedUserId: 'u1' })
    );
  });

  it('caps the session at thirty minutes', async () => {
    const response = await request(app)
      .post('/api/auth/till/assume')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ registerId: 'reg1' });

    const [, payload] = String(response.body.data.token).split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString());
    expect(claims.exp - claims.iat).toBe(30 * 60);
  });

  it('is audited', async () => {
    await request(app)
      .post('/api/auth/till/assume')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ registerId: 'reg1', emulateUserId: 'u1' });

    expect(createAuditLog).toHaveBeenCalled();
  });

  it('needs registers:write', async () => {
    const response = await request(app)
      .post('/api/auth/till/assume')
      .set('Authorization', `Bearer ${adminToken(NO_WRITE)}`)
      .send({ registerId: 'reg1' });

    expect(response.status).toBe(403);
    expect(createRegisterShift).not.toHaveBeenCalled();
  });

  it('is refused without any session at all', async () => {
    const response = await request(app).post('/api/auth/till/assume').send({ registerId: 'reg1' });

    expect(response.status).toBe(401);
  });

  it('404s for a register in another org', async () => {
    getRegisterById.mockResolvedValue(register({ orgId: 'another-org' }));

    const response = await request(app)
      .post('/api/auth/till/assume')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ registerId: 'reg1' });

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/api/routes/__tests__/tillAuth.test.ts -t assume`
Expected: FAIL — 404 on every case.

- [ ] **Step 3: Write the route**

Add to `backend/src/api/routes/till.ts`, and extend its imports with `authenticate`, `AuthRequest`, `DEFAULT_ORG_ID` from `../middleware/auth`, `requirePermission` from `../middleware/authorize`, `TILL_SESSION_MAX_AGE` from `../../services/tillSessions`, and `ForbiddenError` from `../../utils/errors`.

```ts
const assumeSchema = z.object({
  registerId: z.string().trim().min(1),
  /** Whose till is being covered. Recorded, never attributed to. */
  emulateUserId: z.string().trim().min(1).optional(),
}).strict();

/**
 * POST /api/auth/till/assume
 *
 * The one way to a till session without the terminal's device credential, so an
 * admin can cover a register or reproduce what a cashier sees from a back-office
 * browser.
 *
 * This is a deliberate hole in the pairing requirement every other till session
 * goes through, and the fence around it is three-sided: `registers:write`, an
 * audit row per use, and a thirty-minute cap that closes a forgotten session.
 *
 * The shift is attributed to the ADMIN. `emulateUserId` is recorded beside it
 * and is never the attributed identity — see the 020 migration for why.
 */
router.post(
  '/assume',
  authenticate,
  requirePermission('registers', 'write'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = assumeSchema.parse(req.body ?? {});
      const adapter = db.getAdapter();
      const orgId = req.orgId ?? DEFAULT_ORG_ID;

      const register = await adapter.getRegisterById(body.registerId);
      if (!register || String(register.orgId) !== orgId) throw new NotFoundError('Register');
      if (register.status !== 'active') throw new UnprocessableEntityError('This register is not active');

      // A till session minted this way must not itself be assumable, so the
      // caller has to hold a real session: `authenticate` above guarantees it.
      const admin = req.user;
      if (!admin) throw new ForbiddenError('Not authenticated');

      let emulated: Record<string, unknown> | null = null;
      if (body.emulateUserId) {
        emulated = await adapter.getUserById(body.emulateUserId);
        if (!emulated || String(emulated.orgId) !== orgId) throw new NotFoundError('User');
      }

      // Supersede whatever is open, exactly as a PIN sign-on does — two people
      // cannot be on one till.
      const openShift = await getOpenShift(adapter, body.registerId);
      if (openShift) await adapter.endRegisterShift(String(openShift.id), 'superseded');

      const shift = await adapter.createRegisterShift({
        registerId: body.registerId,
        userId: admin.id,
        emulatedUserId: body.emulateUserId ?? null,
      });

      const { token, expiresIn } = mintSession({
        user: { id: admin.id, email: admin.email, roleIds: admin.roleIds, orgId },
        shiftId: String(shift.id),
        registerId: body.registerId,
        maxAgeSeconds: TILL_SESSION_MAX_AGE,
      });

      logger.warn(
        `Register ${body.registerId} assumed by ${admin.email}` +
          (emulated ? ` acting for ${String(emulated.email)}` : '')
      );
      await audit(req, {
        action: 'create',
        entity: 'register_shift',
        entityId: String(shift.id),
        after: {
          registerId: body.registerId,
          userId: admin.id,
          emulatedUserId: body.emulateUserId ?? null,
          assumed: true,
        },
      });

      res.status(201).json({
        success: true,
        data: {
          token,
          expiresIn,
          register: { id: body.registerId, name: register.name, displayCode: register.displayCode },
          actingAs: emulated ? { id: String(emulated.id), name: String(emulated.name) } : null,
          shift,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError(error.errors[0].message));
        return;
      }
      next(error);
    }
  }
);
```

Add `getOpenShift` to the `registerShifts` import at the top of the file.

**Ordering note:** `router.post('/assume', ...)` must be declared **before** `router.post('/', ...)` is mounted at `/till`, or Express will not reach it. Since they are different paths this is safe as written, but if you refactor, keep `/assume` distinct.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npx vitest run src/api/routes/__tests__/tillAuth.test.ts`
Expected: PASS, 17 tests

- [ ] **Step 5: Full backend check**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: no new failures

- [ ] **Step 6: Commit**

```bash
git add backend/src/api/routes/till.ts backend/src/api/routes/__tests__/tillAuth.test.ts
git commit -m "feat(auth): let an admin assume a till

The one path to a till session without the device credential, so a
register can be covered from a back-office browser. Fenced by
registers:write, an audit row per use, and a thirty-minute cap.

The shift is attributed to the admin. The emulated cashier is recorded
beside it and never becomes the attributed identity."
```

---

## Task 8: Frontend SDK

**Files:**
- Modify: `src/lib/api/auth.ts`
- Modify: `src/lib/api/admin.ts`
- Create: `src/lib/api/__tests__/till.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/api/__tests__/till.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authApi } from '../auth';

/**
 * These assert the URL and body the SDK sends. A method that posts to the wrong
 * path typechecks perfectly and fails only in a browser, which is exactly the
 * class of defect this suite exists to catch.
 */
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(
    JSON.stringify({ success: true, data: { token: 't', expiresIn: '30m', user: null, shift: null } }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  ));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('authApi.till', () => {
  it('posts the PIN to the till endpoint', async () => {
    await authApi.till({ pin: '4821' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/auth/till');
    expect(JSON.parse(String(init.body))).toEqual({ pin: '4821' });
  });

  it('sends an empty body on a register that needs no PIN', async () => {
    // The endpoint 400s on a PIN it did not ask for, so an undefined must not
    // be serialised as a key at all.
    await authApi.till({});

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it('never names a register: the device token selects it', async () => {
    await authApi.till({ pin: '4821' });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).not.toHaveProperty('registerId');
  });
});

describe('authApi.assumeTill', () => {
  it('posts the register and the emulated cashier', async () => {
    await authApi.assumeTill({ registerId: 'reg1', emulateUserId: 'u1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/auth/till/assume');
    expect(JSON.parse(String(init.body))).toEqual({ registerId: 'reg1', emulateUserId: 'u1' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/api/__tests__/till.test.ts`
Expected: FAIL — `authApi.till is not a function`

- [ ] **Step 3: Add the SDK methods**

Add to `src/lib/api/auth.ts`. Read the file first and match its existing style for the `authApi` object and its response types.

```ts
/** What a till session returns. `user` and `shift` are null on a no-PIN register. */
export interface TillSession {
  token: string;
  expiresIn: string;
  register: { id: string; name?: string; displayCode?: string };
  user: { id: string; name: string; email: string } | null;
  shift: { id: string; registerId: string; userId: string } | null;
}

export interface AssumedTillSession extends Omit<TillSession, 'user'> {
  /** The cashier being covered. Recorded on the shift, never attributed to. */
  actingAs: { id: string; name: string } | null;
}
```

and inside `authApi`:

```ts
  /**
   * Exchange this terminal's device token for a session.
   *
   * The register is whichever one `X-Register-Token` proves this terminal to be
   * — `api-client.ts` attaches it — so nothing here names one. Omit `pin` on a
   * register with sign-in off: the endpoint refuses a PIN it did not ask for
   * rather than ignoring it.
   */
  till: (body: { pin?: string }) =>
    apiClient.post<TillSession>('/api/auth/till', body.pin ? { pin: body.pin } : {}),

  /** Open a register from a back-office browser. Requires `registers:write`. */
  assumeTill: (body: { registerId: string; emulateUserId?: string }) =>
    apiClient.post<AssumedTillSession>('/api/auth/till/assume', body),
```

Add to `src/lib/api/admin.ts`, inside the `users` object beside `setPin`/`clearPin`:

```ts
    /** Clear a PIN lockout without waiting out the fifteen minutes. Does not change the PIN. */
    unlockPin: (id: string) =>
      apiClient.post<UserPinStatus>(`/api/admin/users/${id}/pin/unlock`, {}),
```

While you are in `src/lib/api/admin.ts`, delete the stale doc comment at lines 23-34 claiming the PIN routes are "not yet wired up server-side". They exist at `backend/src/api/routes/admin.ts:162` and `:208`.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/api/__tests__/till.test.ts && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS, 4 tests, no type errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/
git commit -m "feat(sdk): till session and PIN unlock methods

Also drops the stale note claiming the PIN admin routes are unwired;
they have existed since the pins phase."
```

---

## Task 9: `RequireTill`

**Files:**
- Create: `src/components/RequireTill.tsx`
- Create: `src/components/__tests__/RequireTill.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/__tests__/RequireTill.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getDeviceToken = vi.fn();
vi.mock('@/lib/register-device', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getDeviceToken };
});

const getToken = vi.fn();
vi.mock('@/lib/auth-store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, authStore: { ...(actual.authStore as object), getToken } };
});

const { default: RequireTill } = await import('../RequireTill');

function renderAt(path = '/pos') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/pos" element={<RequireTill><div>THE REGISTER</div></RequireTill>} />
          <Route path="/pair" element={<div>PAIRING SCREEN</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('RequireTill', () => {
  it('sends an unpaired terminal to the pairing screen', async () => {
    // A till without a device credential cannot open a session at all, so the
    // PIN pad would be a dead end.
    getDeviceToken.mockReturnValue(null);
    getToken.mockReturnValue(null);

    renderAt();

    expect(await screen.findByText('PAIRING SCREEN')).toBeInTheDocument();
    expect(screen.queryByText('THE REGISTER')).not.toBeInTheDocument();
  });

  it('shows the PIN pad on a paired terminal with no session', async () => {
    getDeviceToken.mockReturnValue('rt_device');
    getToken.mockReturnValue(null);

    renderAt();

    expect(await screen.findByRole('button', { name: /^1$/ })).toBeInTheDocument();
    expect(screen.queryByText('THE REGISTER')).not.toBeInTheDocument();
  });

  it('shows the register once a session exists', async () => {
    getDeviceToken.mockReturnValue('rt_device');
    getToken.mockReturnValue('jwt');

    renderAt();

    expect(await screen.findByText('THE REGISTER')).toBeInTheDocument();
  });

  it('does not flash the pad while it is still deciding', async () => {
    // The bug this prevents: rendering the lock screen for a frame over an
    // already-signed-on till on every mount.
    getDeviceToken.mockReturnValue('rt_device');
    getToken.mockReturnValue('jwt');

    renderAt();

    await waitFor(() => expect(screen.getByText('THE REGISTER')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^1$/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/__tests__/RequireTill.test.tsx`
Expected: FAIL — `Cannot find module '../RequireTill'`

- [ ] **Step 3: Write the component**

Read `src/components/register/LockScreen.tsx` first for its exact props — the code below assumes it takes an `onUnlocked` callback; adjust to match what is actually there.

```tsx
// src/components/RequireTill.tsx
import { Navigate } from 'react-router-dom';
import { useState } from 'react';
import { getDeviceToken } from '@/lib/register-device';
import { authStore } from '@/lib/auth-store';
import LockScreen from '@/components/register/LockScreen';

/**
 * The register's front door.
 *
 * `RequireAuth` asked "is someone logged in", which meant a cashier needed an
 * email and a password to reach a till. This asks the two questions that
 * actually apply to a terminal: is this device enrolled, and is a till session
 * open on it.
 *
 * An unpaired terminal goes to `/pair` rather than to the PIN pad, because
 * `POST /api/auth/till` refuses a caller with no device credential — showing the
 * pad would be a dead end that looks like a wrong PIN.
 *
 * The session is read synchronously from `authStore`, not fetched, so there is
 * no pending frame in which an already-signed-on till flashes its lock screen.
 */
export default function RequireTill({ children }: { children: React.ReactNode }) {
  const [sessionToken, setSessionToken] = useState(() => authStore.getToken());

  if (!getDeviceToken()) {
    return <Navigate to="/pair" replace />;
  }

  if (!sessionToken) {
    return <LockScreen onUnlocked={() => setSessionToken(authStore.getToken())} />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/components/__tests__/RequireTill.test.tsx`
Expected: PASS, 4 tests

- [ ] **Step 5: Route through it**

In `src/App.tsx`, add the import:

```tsx
import RequireTill from "@/components/RequireTill";
```

and replace the two register routes:

```tsx
              <Route path="/" element={<RequireTill><POS /></RequireTill>} />
              <Route path="/pos" element={<RequireTill><POS /></RequireTill>} />
```

Leave every other route on `RequireAuth`.

- [ ] **Step 6: Verify**

Run: `npx vitest run && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS. `POS.render.test.tsx` renders `POS` directly rather than through the router, so it is unaffected — confirm that is still true.

- [ ] **Step 7: Commit**

```bash
git add src/components/RequireTill.tsx src/components/__tests__/RequireTill.test.tsx src/App.tsx
git commit -m "feat(pos): gate the register on the terminal, not on a login

RequireAuth asked whether someone was logged in, which is why a cashier
needed a password to reach a till. RequireTill asks whether the device
is enrolled and whether a till session is open on it."
```

---

## Task 10: `LockScreen` opens a session

**Files:**
- Modify: `src/components/register/LockScreen.tsx`
- Modify: `src/components/register/__tests__/` (the existing LockScreen test, if there is one)

- [ ] **Step 1: Read what is there**

```bash
cat src/components/register/LockScreen.tsx
ls src/components/register/__tests__/
```

`LockScreen` currently calls the shift endpoint through `useStartShift`. It must call `authApi.till()` instead and store the returned token.

- [ ] **Step 2: Write the failing test**

```tsx
// src/components/register/__tests__/LockScreen.session.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const till = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, authApi: { ...(actual.authApi as object), till } };
});

const setToken = vi.fn();
vi.mock('@/lib/auth-store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, authStore: { ...(actual.authStore as object), setToken, getToken: () => null } };
});

const { default: LockScreen } = await import('../LockScreen');

function renderLock(onUnlocked = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LockScreen onUnlocked={onUnlocked} />
    </QueryClientProvider>
  );
  return onUnlocked;
}

/** Type a PIN on the pad and submit it. */
async function enterPin(pin: string) {
  for (const digit of pin) {
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${digit}$`) }));
  }
  fireEvent.click(await screen.findByRole('button', { name: /sign in|enter|unlock/i }));
}

beforeEach(() => vi.clearAllMocks());

describe('LockScreen', () => {
  it('stores the token the till endpoint returns', async () => {
    till.mockResolvedValue({ token: 'jwt-token', expiresIn: '24h', user: { id: 'u1', name: 'Cashier' }, shift: { id: 's1' } });
    const onUnlocked = renderLock();

    await enterPin('4821');

    await waitFor(() => expect(till).toHaveBeenCalledWith({ pin: '4821' }));
    expect(setToken).toHaveBeenCalledWith('jwt-token', '24h');
    expect(onUnlocked).toHaveBeenCalled();
  });

  it('keeps the pad up and explains a rejected PIN', async () => {
    till.mockRejectedValue(Object.assign(new Error('That PIN was not recognized'), { code: 'PIN_INVALID' }));
    const onUnlocked = renderLock();

    await enterPin('0000');

    expect(await screen.findByText(/not recognized|not recognised/i)).toBeInTheDocument();
    expect(setToken).not.toHaveBeenCalled();
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it('says so when the account is locked, rather than inviting another try', async () => {
    till.mockRejectedValue(Object.assign(new Error('This PIN is locked after too many failed attempts. Try again later.'), { code: 'PIN_LOCKED' }));
    renderLock();

    await enterPin('4821');

    expect(await screen.findByText(/locked/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/components/register/__tests__/LockScreen.session.test.tsx`
Expected: FAIL — `till` is never called; the component still uses `useStartShift`.

- [ ] **Step 4: Rewire the component**

In `LockScreen.tsx`, replace the `useStartShift` mutation with:

```tsx
  const signOn = useMutation({
    mutationFn: (pin: string) => authApi.till({ pin }),
    onSuccess: (session) => {
      // Stored before the callback fires: RequireTill reads the token
      // synchronously to decide whether to keep showing this screen.
      authStore.setToken(session.token, session.expiresIn);
      onUnlocked?.();
    },
  });
```

with imports:

```tsx
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/lib/api';
import { authStore } from '@/lib/auth-store';
```

Keep the existing error rendering; it already reads `getErrorMessage`.

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/components/register/__tests__/ && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS. If an older LockScreen test asserted `useStartShift` was called, update it to assert `authApi.till` — the behaviour it was guarding is now this.

- [ ] **Step 6: Commit**

```bash
git add src/components/register/LockScreen.tsx src/components/register/__tests__/
git commit -m "feat(pos): the PIN pad opens a session, not just a shift"
```

---

## Task 11: The login screen explains itself

**Files:**
- Modify: `src/pages/Login.tsx`
- Modify: `src/pages/__tests__/` (add to the existing Login test, or create `Login.policy.test.tsx`)

- [ ] **Step 1: Write the failing test**

```tsx
// src/pages/__tests__/Login.policy.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const login = vi.fn();
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, login };
});

const { default: Login } = await import('../Login');

function renderLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Login /></MemoryRouter>
    </QueryClientProvider>
  );
}

async function submit() {
  fireEvent.change(await screen.findByLabelText(/email/i), { target: { value: 'c@demo.local' } });
  fireEvent.change(await screen.findByLabelText(/password/i), { target: { value: 'pw' } });
  fireEvent.click(await screen.findByRole('button', { name: /sign in|log in/i }));
}

beforeEach(() => vi.clearAllMocks());

describe('Login', () => {
  it('points a cashier at the till instead of showing a credentials error', async () => {
    // Their password was right. "Invalid credentials" would be both wrong and
    // actively unhelpful — they would keep retyping it.
    login.mockRejectedValue(Object.assign(new Error('Use your PIN at the till.'), { code: 'USE_PIN_AT_TILL' }));
    renderLogin();

    await submit();

    expect(await screen.findByText(/PIN at the till/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid credentials/i)).not.toBeInTheDocument();
  });

  it('still shows an ordinary failure as one', async () => {
    login.mockRejectedValue(Object.assign(new Error('Invalid credentials'), { code: undefined }));
    renderLogin();

    await submit();

    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/pages/__tests__/Login.policy.test.tsx`
Expected: FAIL — the message is not rendered, or the label queries do not match. Fix the queries to match the real form before changing behaviour.

- [ ] **Step 3: Render the message**

In `Login.tsx`'s error handler, branch on the code before falling back:

```tsx
      // A correct password at the wrong door. The generic message would send a
      // cashier round the retype-your-password loop forever.
      const message =
        (error as { code?: string })?.code === 'USE_PIN_AT_TILL'
          ? 'Use your PIN at the till. This screen is for back-office accounts.'
          : getErrorMessage(error, 'Could not sign you in');
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/pages/__tests__/Login.policy.test.tsx`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add src/pages/Login.tsx src/pages/__tests__/Login.policy.test.tsx
git commit -m "feat(login): send a cashier to the till, not round the retype loop"
```

---

## Task 12: Unlock button in `CashierPinManager`

**Files:**
- Modify: `src/components/admin/CashierPinManager.tsx`
- Create: `src/components/admin/__tests__/CashierPinManager.unlock.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/admin/__tests__/CashierPinManager.unlock.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const unlockPin = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const admin = actual.adminApi as { users: object };
  return { ...actual, adminApi: { ...admin, users: { ...admin.users, unlockPin } } };
});

const { default: CashierPinManager } = await import('../CashierPinManager');

function renderFor(user: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CashierPinManager user={user as never} />
    </QueryClientProvider>
  );
}

const LOCKED = { id: 'u1', name: 'Cashier', email: 'c@demo.local', pinSetAt: 1000, pinLockedUntil: Date.now() + 600_000 };
const UNLOCKED = { id: 'u1', name: 'Cashier', email: 'c@demo.local', pinSetAt: 1000, pinLockedUntil: null };

beforeEach(() => vi.clearAllMocks());

describe('CashierPinManager lockout', () => {
  it('shows that the PIN is locked', async () => {
    renderFor(LOCKED);

    expect(await screen.findByText(/locked/i)).toBeInTheDocument();
  });

  it('clears the lockout on request', async () => {
    unlockPin.mockResolvedValue(UNLOCKED);
    renderFor(LOCKED);

    fireEvent.click(await screen.findByRole('button', { name: /unlock/i }));

    await waitFor(() => expect(unlockPin).toHaveBeenCalledWith('u1'));
  });

  it('offers no unlock button when nothing is locked', async () => {
    renderFor(UNLOCKED);

    expect(screen.queryByRole('button', { name: /unlock/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/admin/__tests__/CashierPinManager.unlock.test.tsx`
Expected: FAIL — no locked indicator, no unlock button. Adjust the `user` prop shape to match the component's real props before proceeding.

- [ ] **Step 3: Add the state and the button**

In `CashierPinManager.tsx`:

```tsx
  const isLocked = user.pinLockedUntil != null && Number(user.pinLockedUntil) > Date.now();

  const unlock = useMutation({
    mutationFn: () => adminApi.users.unlockPin(user.id),
    onSuccess: () => {
      toast({ title: 'PIN unlocked', description: `${user.name} can sign in again.` });
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
  });
```

and in the render, beside the existing PIN controls:

```tsx
      {isLocked && (
        <div className="flex items-center gap-3" role="status">
          <span className="text-sm text-destructive">
            PIN locked after too many failed attempts
          </span>
          <Button variant="outline" size="sm" onClick={() => unlock.mutate()} disabled={unlock.isPending}>
            Unlock
          </Button>
        </div>
      )}
```

Match the query key this file already invalidates after `setPin`; if it uses a different key, use that one.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/components/admin/__tests__/ && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/CashierPinManager.tsx src/components/admin/__tests__/
git commit -m "feat(admin): clear a PIN lockout from the cashier's row"
```

---

## Task 13: The acting-as banner

**Files:**
- Create: `src/components/register/ActingAsBanner.tsx`
- Create: `src/components/register/__tests__/ActingAsBanner.test.tsx`
- Modify: `src/pages/POS.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/register/__tests__/ActingAsBanner.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActingAsBanner from '../ActingAsBanner';

describe('ActingAsBanner', () => {
  it('names the admin and the cashier being covered', () => {
    render(<ActingAsBanner adminName="Admin User" actingAs="Sam Cashier" onExit={vi.fn()} />);

    expect(screen.getByText(/Admin User/)).toBeInTheDocument();
    expect(screen.getByText(/Sam Cashier/)).toBeInTheDocument();
  });

  it('says sales attribute to the admin, so nobody assumes otherwise', () => {
    // The banner is the only place a user learns this, and it is the difference
    // between an honest cashier report and a misleading one.
    render(<ActingAsBanner adminName="Admin User" actingAs="Sam Cashier" onExit={vi.fn()} />);

    expect(screen.getByText(/recorded against Admin User/i)).toBeInTheDocument();
  });

  it('reads sensibly when no cashier is being covered', () => {
    render(<ActingAsBanner adminName="Admin User" actingAs={null} onExit={vi.fn()} />);

    expect(screen.getByText(/Admin User/)).toBeInTheDocument();
  });

  it('offers a way out', () => {
    const onExit = vi.fn();
    render(<ActingAsBanner adminName="Admin User" actingAs="Sam" onExit={onExit} />);

    fireEvent.click(screen.getByRole('button', { name: /end|exit/i }));

    expect(onExit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/register/__tests__/ActingAsBanner.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

```tsx
// src/components/register/ActingAsBanner.tsx
import { Button } from '@/components/ui/button';
import { UserCog } from 'lucide-react';

interface ActingAsBannerProps {
  adminName: string;
  /** The cashier being covered, when one was named. */
  actingAs: string | null;
  onExit: () => void;
}

/**
 * Shown for the whole of an assumed session.
 *
 * An admin driving a till that is not theirs is a state someone can forget they
 * are in, and the consequences land in the reports. The banner is deliberately
 * loud and deliberately explicit that attribution follows the admin, not the
 * cashier being covered — this is the only place a user is told that, and
 * assuming the opposite is the easy mistake.
 */
export default function ActingAsBanner({ adminName, actingAs, onExit }: ActingAsBannerProps) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-amber-500 bg-amber-50 px-4 py-2 dark:bg-amber-950"
    >
      <div className="flex items-center gap-2 text-sm">
        <UserCog className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <span className="font-medium text-amber-900 dark:text-amber-100">
          {actingAs
            ? `${adminName} is covering ${actingAs}'s till`
            : `${adminName} is signed on to this till`}
        </span>
        <span className="text-amber-800/80 dark:text-amber-200/80">
          Sales are recorded against {adminName}.
        </span>
      </div>
      <Button variant="outline" size="sm" onClick={onExit}>
        End session
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/components/register/__tests__/ActingAsBanner.test.tsx`
Expected: PASS, 4 tests

- [ ] **Step 5: Render it in the POS**

A component nobody mounts is not a feature. Store the details alongside the token
when `assumeTill` succeeds (Task 14), with a helper beside `authStore`:

```ts
// src/lib/auth-store.ts
const ASSUMED_KEY = 'assumed_session';

/** Details of an assumed till session, or null at an ordinary till. */
export function readAssumedSession(): { adminName: string; actingAs: string | null } | null {
  const raw = localStorage.getItem(ASSUMED_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function writeAssumedSession(value: { adminName: string; actingAs: string | null } | null): void {
  if (value) localStorage.setItem(ASSUMED_KEY, JSON.stringify(value));
  else localStorage.removeItem(ASSUMED_KEY);
}
```

`authStore.clearToken` must also call `writeAssumedSession(null)`, or the banner
outlives the session it describes.

Then in `src/pages/POS.tsx`, above the register header:

```tsx
  // Set only by `POST /api/auth/till/assume`. An ordinary PIN session writes
  // nothing here, so the banner never appears at a real till.
  const assumed = readAssumedSession();
```

```tsx
      {assumed && (
        <ActingAsBanner
          adminName={assumed.adminName}
          actingAs={assumed.actingAs}
          onExit={handleSignOut}
        />
      )}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/register/ActingAsBanner.tsx src/components/register/__tests__/ActingAsBanner.test.tsx src/pages/POS.tsx src/lib/auth-store.ts
git commit -m "feat(pos): banner for an assumed till session

States plainly that sales attribute to the admin, which is the easy
thing to assume the other way round."
```

---

## Task 14: Assume a till from Admin → Registers

The endpoint from Task 7 has no way to reach it from the UI. This is that way.

**Files:**
- Modify: `src/pages/admin/AdminRegisters.tsx`
- Create: `src/pages/admin/__tests__/AdminRegisters.assume.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/pages/admin/__tests__/AdminRegisters.assume.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const assumeTill = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    authApi: { ...(actual.authApi as object), assumeTill },
    registersApi: {
      ...(actual.registersApi as object),
      list: vi.fn(async () => [
        { id: 'reg1', name: 'Register 1', displayCode: 'MAIN-01', status: 'active', requireSignIn: true },
      ]),
    },
  };
});

const setToken = vi.fn();
const writeAssumedSession = vi.fn();
vi.mock('@/lib/auth-store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, authStore: { ...(actual.authStore as object), setToken }, writeAssumedSession };
});

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/ProtectedRoute', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const { default: AdminRegisters } = await import('../AdminRegisters');

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><AdminRegisters /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('assuming a register', () => {
  it('opens the till and goes to the register', async () => {
    assumeTill.mockResolvedValue({
      token: 'jwt', expiresIn: '1800s',
      register: { id: 'reg1', name: 'Register 1' },
      actingAs: null, shift: { id: 's1' },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /open this register/i }));

    await waitFor(() => expect(assumeTill).toHaveBeenCalledWith({ registerId: 'reg1' }));
    expect(setToken).toHaveBeenCalledWith('jwt', '1800s');
    expect(navigate).toHaveBeenCalledWith('/pos');
  });

  it('records who is being covered so the banner can say so', async () => {
    assumeTill.mockResolvedValue({
      token: 'jwt', expiresIn: '1800s',
      register: { id: 'reg1', name: 'Register 1' },
      actingAs: { id: 'u1', name: 'Sam Cashier' }, shift: { id: 's1' },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /open this register/i }));

    await waitFor(() =>
      expect(writeAssumedSession).toHaveBeenCalledWith(
        expect.objectContaining({ actingAs: 'Sam Cashier' })
      )
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/pages/admin/__tests__/AdminRegisters.assume.test.tsx`
Expected: FAIL — no "Open this register" button exists

- [ ] **Step 3: Add the action**

In `AdminRegisters.tsx`, beside the existing per-register actions:

```tsx
  /**
   * Open a till from the back office, without this browser being paired.
   *
   * The one path to a till session that skips the device credential, so it is
   * audited server-side and capped at thirty minutes. Sales ring up against the
   * admin, not the cashier being covered — `ActingAsBanner` says so on screen.
   */
  const assume = useMutation({
    mutationFn: (registerId: string) => authApi.assumeTill({ registerId }),
    onSuccess: (session) => {
      authStore.setToken(session.token, session.expiresIn);
      writeAssumedSession({
        adminName: currentUserName,
        actingAs: session.actingAs?.name ?? null,
      });
      navigate('/pos');
    },
    onError: (error) =>
      toast({
        title: 'Could not open that register',
        description: getErrorMessage(error),
        variant: 'destructive',
      }),
  });
```

```tsx
                {register.status === 'active' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => assume.mutate(register.id)}
                    disabled={assume.isPending}
                  >
                    Open this register
                  </Button>
                )}
```

`currentUserName` comes from `useSession()`, which this page can call the same
way `RequireAuth` does.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/pages/admin/__tests__/AdminRegisters.assume.test.tsx && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/AdminRegisters.tsx src/pages/admin/__tests__/AdminRegisters.assume.test.tsx
git commit -m "feat(admin): open a till from the registers screen

The one path to a till session without a paired device. Audited and
capped server-side; the POS banner states that sales ring up against
the admin, not the cashier being covered."
```

---

## Task 15: The POS Admin button follows permission

**Files:**
- Modify: `src/pages/POS.tsx`
- Modify: `src/pages/__tests__/POS.render.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/pages/__tests__/POS.render.test.tsx`, inside the existing `describe('the register header', ...)`:

```tsx
  it('hides Admin from a cashier who cannot use it', async () => {
    // The button used to be unconditional. With a cashier PIN session behind it
    // rather than a back-office login, it would lead only to 403s.
    sessionQuery.data = {
      ...sessionQuery.data,
      roles: [{ id: 'r1', name: 'Standard', systemRole: 'standard', permissions: { reports: { read: false } } }],
    };

    renderRegister();

    await screen.findByRole('button', { name: /^Settings$/i });
    expect(screen.queryByRole('button', { name: /^Admin$/i })).not.toBeInTheDocument();
  });

  it('shows Admin to a supervisor who PINned in', async () => {
    sessionQuery.data = {
      ...sessionQuery.data,
      roles: [{ id: 'r2', name: 'Supervisor', systemRole: 'supervisor', permissions: { reports: { read: true } } }],
    };

    renderRegister();

    expect(await screen.findByRole('button', { name: /^Admin$/i })).toBeInTheDocument();
  });
```

Read the top of that file for how `sessionQuery` is stubbed and match it; the shape above is a guess at the existing fixture.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/pages/__tests__/POS.render.test.tsx`
Expected: FAIL — Admin is rendered for the cashier.

- [ ] **Step 3: Gate the button**

In `POS.tsx`, wrap the Admin button. `hasPermission` is already exported from `@/lib/auth` and used by `RequireAuth`:

```tsx
  // `/admin` needs reports:read — the same permission App.tsx gates the route
  // on. A button that only ever 403s is worse than no button.
  const canReachAdmin = session ? hasPermission(session, 'reports', 'read') : false;
```

```tsx
            {canReachAdmin && (
              <Button variant="outline" onClick={() => navigate('/admin')} className="border-border" size="sm">
                <ShieldCheck className="w-4 h-4 mr-1" />
                Admin
              </Button>
            )}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/pages/__tests__/POS.render.test.tsx`
Expected: PASS. The existing "sends Admin to /admin" and "does not send anyone to the login page" cases need a session with `reports:read` — update their fixture if they now fail.

- [ ] **Step 5: Commit**

```bash
git add src/pages/POS.tsx src/pages/__tests__/POS.render.test.tsx
git commit -m "feat(pos): show Admin only to someone who can use it"
```

---

## Task 16: Seed a PIN for the demo admin

**Files:**
- Modify: whichever file seeds `admin@demo.local` (find it with the command below)
- Modify: `backend/scripts/setup-database.ts:54`

- [ ] **Step 1: Find the seeder**

```bash
grep -rn "admin@demo.local" backend/src backend/scripts --include="*.ts" | grep -iv test
```

- [ ] **Step 2: Set a PIN when seeding**

In the seeder, after the admin user is created, add:

```ts
  // Without a PIN, a paired till is unusable the moment PIN sign-on ships —
  // including on a fresh local stack. Real deployments set PINs through
  // Admin → Roles & Users.
  await setPin(adapter, DEFAULT_ORG_ID, String(adminUser.id), '4821');
```

with `import { setPin } from '../services/pins';` (adjust the relative path).

- [ ] **Step 3: Print it beside the password**

In `backend/scripts/setup-database.ts`, after the existing password line:

```ts
    logger.info('  Register PIN: 4821');
```

- [ ] **Step 4: Verify against a fresh database**

```bash
docker compose down -v && docker compose up -d --build
sleep 25
docker compose exec -T postgres psql -U stewardpos_user -d stewardpos \
  -c "select email, pin_hash is not null as has_pin from users;"
```

Expected: `admin@demo.local | t`

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "chore(seed): give the demo admin a register PIN

A paired till is unusable without one, including on a fresh local stack."
```

---

## Task 17: End-to-end verification

No code. Prove the whole thing works in the running stack before calling it done.

- [ ] **Step 1: Rebuild both containers**

```bash
docker compose up -d --build
sleep 20
```

- [ ] **Step 2: A cashier cannot use the password form**

```bash
# Create a standard-role user through the admin UI first, then:
curl -s -X POST http://localhost:3002/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<the standard user>","password":"<their password>"}' | head -c 200
```

Expected: `403` and `"code":"USE_PIN_AT_TILL"`

- [ ] **Step 3: An admin still can**

```bash
curl -s -X POST http://localhost:3002/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.local","password":"DemoPass!1"}' | head -c 120
```

Expected: `"success":true` with a token

- [ ] **Step 4: The till endpoint refuses an unpaired caller**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3002/api/auth/till \
  -H 'Content-Type: application/json' -d '{"pin":"4821"}'
```

Expected: `401`

- [ ] **Step 5: Walk it in a browser**

Open `http://localhost:8081/pos`. Confirm, in order:
1. An unpaired browser lands on `/pair`.
2. After pairing a register that has sign-in on, the PIN pad appears.
3. `4821` opens the register.
4. Signing out returns to the PIN pad, **not** to `/login`.
5. `admin@demo.local` still reaches `/admin`, and Reports is there and loads.
6. Admin → Registers → **Open this register** lands on the POS with the amber
   acting-as banner, and **End session** returns to the PIN pad.

- [ ] **Step 6: Full suites**

```bash
npx vitest run && npx tsc -p tsconfig.app.json --noEmit
cd backend && npx vitest run && npx tsc --noEmit
```

Expected: all green except the 25 integration files that fail on the database-name guard, which is pre-existing.

- [ ] **Step 7: Commit anything outstanding, then open the PR**

```bash
git add -A && git status
```

---

## Notes on things that will surprise you

**`POST /api/registers/:id/shifts` still exists and still returns no token.** It is not dead: `RegisterSwitcher` and the override flow may still use it. Leave it alone. If nothing calls it after Task 10, removing it is a separate change with its own commit.

**`requireSignIn` defaults to `false`** (`AdminRegisters.tsx:137`). A freshly created register mints sessions from the device token alone, with no PIN prompt. That is the intended behaviour, not a bug — the admin turns sign-in on per register.

**`authenticate` is the highest-blast-radius file in the repo.** Every authenticated route runs through it. Task 2 must be green across the whole backend suite before you start Task 3.

**Do not fix the failing integration tests.** They refuse to run unless the database is named `test`. That guard is deliberate and they run in CI.
