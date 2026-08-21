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
| Terminal pairing issuing `X-Register-Token` | `backend/src/services/registerEnrolment.ts` |

The gap is that a PIN opens a *shift*, and nothing turns a shift into a
*session*.

## What we are building

The password screen becomes the back office door. The PIN pad becomes the till
door. A paired terminal always asks for a PIN; nothing else gets into the
register.

## Decisions

1. **A PIN mints a session.** New `POST /api/auth/pin` returns a JWT.
   Rejected alternatives: making `X-Register-Token` itself a credential (turns a
   stolen terminal token into a standing credential, and every route's `req.user`
   would have to be derived from the shift); UI-only restriction (cashiers would
   still each need a password, so it does not deliver PIN-for-POS at all).
2. **Pairing is required.** `POST /api/auth/pin` is refused without a valid
   device token, so a four-digit PIN is never the only thing in front of the
   store's data, and PIN guessing is impossible from an unenrolled browser.
3. **Login refuses cashiers.** A user whose roles are all `standard` is turned
   away from the password form. Admin, Supervisor and Reporter keep it — Reporter
   exists to read reports, which are now admin-only.
4. **A PIN session dies with its shift.** The JWT carries `shiftId`;
   `authenticate` rejects it once that shift is closed.

## Design

### `POST /api/auth/pin`

Authenticated by the device token, not by a user. The register is taken from
that token and never from the request body — a client cannot ask for a session
at a till it is not sitting at.

```
Request:  { pin: string }            + X-Register-Token
Response: { token, expiresIn, user, shift }
```

The handler stays thin, the way `reports.ts` handlers are thin: it validates the
body, resolves the caller's register, and delegates to `startShift`, which
already scans every active PIN holder in constant time, applies the lockout
counter, and supersedes any shift already open at that till.

`startShift`'s four failure results map to HTTP:

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
place lazy idle expiry is decided, so routing session validation through it
means an idle session and an idle shift can never disagree. Signing out, idle
timeout, another cashier superseding the shift, and an admin revoking the
register therefore all end the session on its next request.

This costs no extra round trip in the common case — `authenticate` already
queries the database on every request to load roles fresh.

Password sessions carry no `shiftId` and take none of this path.

### Login policy

After the password comparison in `POST /api/auth/login`, a user whose roles are
all `standard` — or who has no roles — is refused:

```
403  { code: 'USE_PIN_AT_TILL', error: 'Use your PIN at the till.' }
```

Placed after the password check on purpose: refusing before it would make the
endpoint an oracle for which addresses belong to cashiers.

`Login.tsx` renders that message specifically instead of a generic failure.

### POS routing

`/` and `/pos` drop `RequireAuth` for a new `RequireTill` gate:

| Terminal state | Result |
|---|---|
| Not paired | Redirect to `/pair` |
| Paired, no session | `LockScreen` + `PinPad` → `POST /api/auth/pin` |
| Paired, shift open | The register |

The lock screen becomes the entry condition rather than an overlay drawn on an
already-authenticated page. `requireSignIn` stops deciding whether a PIN is
needed — a paired till always needs one — and keeps exactly the meaning it has
server-side today: `orders.ts:380` refuses a checkout when a register has the
flag set and no shift is open. That check is untouched. In practice a paired
till will now always have a shift, so the flag becomes a belt-and-braces
server-side assertion rather than the thing that gates the UI.

**Back-office users are not tills.** `RequireTill` applies to `/` and `/pos`
only. An admin opening `/pos` in an unpaired browser is redirected to `/pair`
rather than shown the register — the register is a paired-terminal surface now.
The admin area is unaffected and stays behind `RequireAuth`.

Signing out clears the token and returns to the PIN pad, not to `/login`.

The POS's Admin button renders only when the signed-on cashier's role actually
grants back-office access, so a supervisor who PINs in still reaches it and a
standard cashier never sees a button that would only produce 403s.

### Seeding

The seeded `admin@demo.local` gets a PIN, printed by `setup-database.ts`
alongside the existing password line. Without it a paired till is unusable the
moment this ships, including on a local stack. Real deployments set PINs through
`CashierPinManager`.

## Testing

**Backend**
- No device token → 401, and no shift is opened
- Bad PIN → 401 `BAD_PIN`; locked account → 401 `PIN_LOCKED`
- Success returns a token whose `shiftId` matches the opened shift
- That token authorizes a normal request, then 401s `SHIFT_ENDED` once the shift is ended
- A token whose shift passed its idle window is refused without any explicit end call
- Standard-only user refused at `/login` with `USE_PIN_AT_TILL`; admin, supervisor and reporter accepted
- The register is taken from the device token: a body naming another register cannot change it

**Frontend**
- Paired terminal with no session renders the PIN pad, not the register
- A correct PIN reveals the register; a wrong one keeps the pad and shows the message
- Unpaired terminal redirects to `/pair`
- Admin button is absent for a standard cashier and present for a supervisor

## Risks

- **Lockout.** A store with no PIN set cannot open its tills. Mitigated by
  seeding and by `CashierPinManager` already existing; deliberately *not*
  mitigated by a no-PINs-exist bypass, which would be a permanent hole.
- **Scope of `authenticate`.** Every authenticated route inherits the shift
  check. The added path is guarded by `shiftId` being present, so password
  sessions are unaffected, and existing route tests cover the regression surface.
- **`requireSignIn` changes meaning.** Registers with it off previously needed no
  PIN. After this they do. This is the intent of the change, but it is a
  behaviour change for any existing till with the flag off.
