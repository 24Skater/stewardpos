# Password login for the back office, PIN for the till

**Date:** 2026-08-21
**Status:** Approved, not yet implemented

## The problem

A cashier cannot reach the register without an email and a password.

`/pos` is wrapped in `RequireAuth`, and `authenticate` accepts only a user JWT
or an API key. The register's device credential (`X-Register-Token`) is
*attribution* — it tells the server which till rang a sale — and cannot
authorize a call. So the PIN pad that already exists is a second gate stacked
on a password session, reached only when that register has `requireSignIn` set.

Everything a PIN needs is already built and unused as a way in:

| Piece | Where |
|---|---|
| PIN hashing, verification, lockout, org-wide uniqueness | `backend/src/services/pins.ts` |
| `startShift(registerId, pin)` → user + shift, with supersede | `backend/src/services/registerShifts.ts` |
| Lazy idle expiry of an open shift | `registerShifts.getOpenShift()` |
| PIN pad and lock screen | `src/components/register/{PinPad,LockScreen}.tsx` |
| Admin screen to set and clear PINs | `src/components/admin/CashierPinManager.tsx` |
| `PUT`/`DELETE /api/admin/users/:id/pin` | `backend/src/api/routes/admin.ts` |
| Per-register capability flags, admin-editable | `src/pages/admin/AdminRegisters.tsx` |
| Terminal pairing issuing `X-Register-Token` | `backend/src/services/registerEnrolment.ts` |

The gap is that a PIN opens a *shift*, and nothing turns a shift into a
*session*.

## What we are building

The password screen becomes the back office door. A paired terminal becomes the
till door, asking for a PIN when the register is configured to want one.

The admin keeps the controls: whether a given register requires sign-in, what it
is allowed to do, how long it idles, whose PIN works, whether a locked-out
cashier has to wait, and — when someone has to cover a till — the ability to open
any register from a back-office browser.

## Decisions

1. **A till session is minted by the server**, via `POST /api/auth/till`, and is
   an ordinary JWT. Rejected: making `X-Register-Token` itself a credential (a
   stolen terminal token becomes a standing credential, and every route's
   `req.user` would have to be derived from the shift); UI-only restriction
   (cashiers would still each need a password).
2. **Pairing is required** for `POST /api/auth/till`, so a four-digit PIN is
   never the only thing in front of the store's data and PIN guessing is
   impossible from an unenrolled browser. `assume` (decision 6) is the one
   deliberate, audited exception.
3. **`requireSignIn` stays the admin's switch.** Whether a till asks for a PIN is
   a per-register setting an admin already edits, not something this change
   decides. A register with it off mints a session from the device token alone.
4. **Login refuses cashiers.** A user whose roles are all `standard` is turned
   away from the password form. Admin, Supervisor and Reporter keep it — Reporter
   exists to read the reports, which are now admin-only.
5. **A till session dies with its shift.** The JWT carries `shiftId`;
   `authenticate` rejects it once that shift is closed.
6. **An admin can assume a till.** `POST /api/auth/till/assume` mints a till
   session for any register without its device token, optionally naming a cashier
   to emulate. Gated on `registers:write`, audited, time-boxed to 30 minutes.
   Sales attribute to the **admin**, never to the emulated cashier.
7. **An admin can clear a PIN lockout** rather than waiting out the 15 minutes.

## Design

### `POST /api/auth/till`

Authenticated by the device token, not by a user. The register is taken from that
token and never from the request body — a client cannot ask for a session at a
till it is not sitting at.

```
Request:  { pin?: string }           + X-Register-Token
Response: { token, expiresIn, register, user | null, shift | null }
```

Two modes, chosen by the register's own setting, not by the caller:

| `requireSignIn` | Body | Session identity | Sale attribution |
|---|---|---|---|
| `true` | `{ pin }` — required | The cashier the PIN resolves to | That cashier |
| `false` | `{}` — a PIN is rejected | The register itself | `unknown` |

The no-PIN mode introduces no new attribution concept. `CashierSales` already
documents `cashierUserId: 'unknown'` as the bucket for orders that predate shift
tracking, and `orders.ts:380` already permits a checkout with no open shift when
the flag is off. A no-PIN session simply keeps producing rows that land in that
bucket, so the per-cashier split still reconciles to the unfiltered total.

A PIN submitted to a register that does not want one is refused rather than
ignored, for the reason `registerHourlySchema` omits the filters it cannot
honour: accepting a parameter and silently doing nothing with it invites the
caller to believe it took effect.

In PIN mode the handler stays thin, the way `reports.ts` handlers are thin: it
validates the body, resolves the caller's register, and delegates to
`startShift`, which already scans every active PIN holder in constant time,
applies the lockout counter, and supersedes any shift already open at that till.

`startShift`'s failure results map to HTTP:

| Result | Status | `code` |
|---|---|---|
| `bad_pin` | 401 | `BAD_PIN` |
| `locked` | 401 | `PIN_LOCKED` |
| `register_not_active` | 403 | `REGISTER_NOT_ACTIVE` |
| `register_not_found` | 404 | — |

`BAD_PIN` and `PIN_LOCKED` are distinguished so the pad can say "PIN not
recognised" rather than "locked out" and vice versa. Neither response says
*whose* PIN was wrong. Rate-limited on the same limiter as `/login`.

### Shift-bound sessions

`TokenClaims` gains an optional `shiftId`. In `authenticate`, a token carrying
one resolves its shift through `registerShifts.getOpenShift()` and fails with
401 `SHIFT_ENDED` when the shift is no longer open.

`getOpenShift` is used deliberately rather than a raw row read: it is the one
place lazy idle expiry is decided, so routing session validation through it means
an idle session and an idle shift can never disagree. Signing out, idle timeout,
another cashier superseding the shift, and an admin revoking the register
therefore all end the session on its next request.

This costs no extra round trip in the common case — `authenticate` already
queries the database on every request to load roles fresh.

A no-PIN session has no shift, so it carries `registerId` instead of `shiftId`
and is validated against the register still being active. Password sessions carry
neither and take none of this path.

### `POST /api/auth/till/assume`

The one way to get a till session without the terminal's device credential, so
an admin can cover or reproduce a till from a back-office browser.

```
Request:  { registerId, emulateUserId? }   + a password session
Response: { token, expiresIn, register, actingAs }
```

- Requires `registers:write`.
- Writes an audit entry naming the admin, the register, and the emulated cashier.
- The minted token expires after **30 minutes** regardless of register idle
  settings, so a forgotten assumed session closes itself.
- The shift row records `actingUserId` (the admin) alongside the emulated user.
  **`cashierUserId` is the admin.** Reports and audit show the admin.

That last point is the important one and it is deliberate. `sales-by-cashier`,
`drawer-variance-by-register` and `no-sale-counts` exist to answer "who was
standing at this till". An admin able to file sales under a cashier's name would
make all three unable to distinguish a cashier's own sale from an admin's,
including in exactly the dispute they exist to settle. The emulated identity is
recorded so the *intent* is visible; it is never the attributed one.

The POS shows a persistent banner naming the admin and the emulated cashier,
with an exit that ends the assumed session and returns to the back office.

### `POST /api/admin/users/:id/pin/unlock`

`pins.ts:29` locks an account for 15 minutes after repeated failures. This calls
the existing `resetPinFailures`, gated on `users:write` and audited.
`CashierPinManager.tsx` gains lock state and a button to clear it. The automatic
expiry is unchanged; this only means a manager need not wait it out.

### Login policy

After the password comparison in `POST /api/auth/login`, a user whose roles are
all `standard` — or who has no roles — is refused:

```
403  { code: 'USE_PIN_AT_TILL', error: 'Use your PIN at the till.' }
```

Placed after the password check on purpose: refusing before it would make the
endpoint an oracle for which addresses belong to cashiers.

`Login.tsx` renders that message specifically rather than a generic failure.

### POS routing

`/` and `/pos` drop `RequireAuth` for a new `RequireTill` gate:

| Terminal state | Result |
|---|---|
| Assumed session active | The register, with the acting-as banner |
| Not paired | Redirect to `/pair` |
| Paired, no session, `requireSignIn` | `LockScreen` + `PinPad` → `POST /api/auth/till` |
| Paired, no session, no sign-in required | Mint silently, then the register |
| Paired, session live | The register |

The lock screen becomes the entry condition rather than an overlay drawn on an
already-authenticated page. `orders.ts:380` is untouched: it remains the
server-side assertion that a sign-in register does not take a sale without a
shift.

`RequireTill` applies to `/` and `/pos` only. The admin area stays behind
`RequireAuth`. An admin who wants the register from a laptop uses `assume`
rather than pairing their browser.

Signing out clears the token and returns to the PIN pad, not to `/login`.

The POS's Admin button renders only when the signed-on identity actually grants
back-office access, so a supervisor who PINs in still reaches it and a standard
cashier never sees a button that would only produce 403s.

### Seeding

The seeded `admin@demo.local` gets a PIN, printed by `setup-database.ts`
alongside the existing password line, so a paired till is usable on a fresh
local stack. Real deployments set PINs through `CashierPinManager`.

## Testing

**Backend**
- No device token → 401, and no shift is opened
- Bad PIN → 401 `BAD_PIN`; locked account → 401 `PIN_LOCKED`
- PIN mode returns a token whose `shiftId` matches the opened shift
- That token authorizes a request, then 401s `SHIFT_ENDED` once the shift ends
- A token whose shift passed its idle window is refused with no explicit end call
- No-PIN register: empty body mints a session; a submitted PIN is refused
- The register comes from the device token: a body naming another cannot change it
- `assume` without `registers:write` → 403; with it, mints a token, writes an
  audit row, and expires after 30 minutes
- A sale rung in an assumed session attributes to the admin, not the emulated user
- `pin/unlock` clears the lockout and is audited; requires `users:write`
- Standard-only user refused at `/login` with `USE_PIN_AT_TILL`; admin,
  supervisor and reporter accepted

**Frontend**
- Paired sign-in register with no session renders the PIN pad, not the register
- Paired no-sign-in register goes straight to the register
- A correct PIN reveals the register; a wrong one keeps the pad and shows why
- Unpaired terminal redirects to `/pair`
- An assumed session shows the acting-as banner and its exit
- Admin button absent for a standard cashier, present for a supervisor

## Risks

- **`assume` is a pairing bypass.** It is the one path to a till session without
  the device credential. Mitigated by `registers:write`, an audit row per use, and
  a 30-minute cap — but anyone holding that permission can open any till from
  anywhere, and that is the accepted trade for being able to cover a register.
- **Lockout.** A store whose sign-in registers have no PINs set cannot open those
  tills. Mitigated by seeding, by `CashierPinManager`, by `assume`, and by
  `requireSignIn` being off by default. Deliberately *not* mitigated by a
  no-PINs-exist bypass, which would be a permanent hole.
- **Scope of `authenticate`.** Every authenticated route inherits the session
  check. The added path is guarded by `shiftId`/`registerId` being present, so
  password sessions are unaffected and existing route tests cover the regression
  surface.
- **No-PIN tills attribute to `unknown`.** This is the existing behaviour of a
  `requireSignIn: false` register, not a regression, but a store that turns
  sign-in off store-wide gets a cashier report with one bucket in it.
