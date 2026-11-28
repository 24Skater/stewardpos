# T-29 Time clock screens and CSV

Tier: sonnet. Review: N. Branch: feat/T-29-time-clock-ui. Depends: T-28.

## Files
- Register: Clock in/out and Break buttons on the lock screen (`components/register/LockScreen.tsx`) using the PIN pad.
- Admin: hours by person and by event/period, edit with reason, CSV export (copy `AdminExports.tsx` CSV helper).

## Tests
Clock-in from lock screen; CSV header and rows.

## Docs
`docs/guides/time-clock.md` (volunteer hours section).
