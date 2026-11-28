# T-28 Time clock: clock in and out by PIN, breaks, supervised edits

Tier: sonnet. Review: Y (permissions, privacy). Branch: feat/T-28-time-clock. Depends: T-01.

## Files
- Migration `043_time_clock.sql`: `time_entries(id, org_id, user_id, clock_in_at, clock_out_at NULL, register_shift_id NULL, event_label NULL, is_volunteer BOOLEAN)`, `time_breaks(id, org_id, entry_id, start_at, end_at NULL)`, `time_entry_edits(id, org_id, entry_id, editor_id, supervisor_id, reason, before, after, created_at)`.
- New `backend/src/services/timeClock.ts`: PIN verification reuses `services/pins.ts`; one open entry per user; link to the open till shift from `registerShifts.getOpenShift` when present, separate otherwise.
- Edits require `reason` and an approving supervisor (reuse `registerOverrides.ts` approval) and an audit entry.
- Routes `backend/src/api/routes/timeClock.ts`: new permission resource `timeclock` in `PERMISSION_RESOURCES` (`authorize.ts` line 22). `read` own hours for everyone; all hours need `timeclock:read` granted to Admin and Supervisor in `seeder.ts` plus a migration for existing roles.
- Overtime flag: setting `overtimeHoursPerWeek` (null = off).
- Events: `timeclock.clocked_in`, `timeclock.clocked_out`.

## Tests
Double clock-in refused; edit without reason refused; Standard user sees only own hours; overtime flag.
