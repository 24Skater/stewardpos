-- Let the audit trail record an event that no user performed.
--
-- Some audited events genuinely have no human on the request. A terminal
-- redeeming a pairing code and a cashier signing on with a PIN are both
-- authenticated by `X-Register-Token`, not a session, so `req.user` is
-- undefined and `services/audit.ts` writes a null `userId` — which the routes
-- were written to expect and say so in their comments.
--
-- `user_id` was NOT NULL, so every one of those inserts violated the
-- constraint. `audit()` deliberately never throws (a failed audit write must
-- not roll back the sale it describes), so the failure was logged and
-- discarded: PIN sign-on, sign-out and device enrolment produced no audit rows
-- at all, for as long as the feature had existed, without one visible symptom
-- at the call site.
--
-- Nullable is the honest shape. "Nobody, this was a device" is a real answer
-- and is better recorded as NULL than forged into some convenient user's name;
-- `getAuditLogs` already LEFT JOINs `users`, so an unattributed row reads back
-- with no name rather than disappearing. Where a human IS knowable the routes
-- now name them explicitly — see `AuditInput.actorUserId`.
ALTER TABLE audit_logs ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN audit_logs.user_id IS
  'Who performed the action, or NULL when a device did: see migration 021.';

-- What did it, when no user did.
--
-- `user_id` going nullable keeps the row; this says who to blame for it. A
-- non-human principal has a synthetic id — `register:<uuid>` for a no-PIN till
-- session, `api-key:<uuid>` for a key — which is a UUID column's problem twice
-- over: wrong shape, and no matching `users` row. Those inserts did not produce
-- a badly-attributed row, they produced no row at all, so every action an API
-- key ever performed went unrecorded. The label is how the trail names a caller
-- that is not a person, instead of showing "Unknown".
ALTER TABLE audit_logs ADD COLUMN actor_label VARCHAR(200);

COMMENT ON COLUMN audit_logs.actor_label IS
  'Non-human caller that performed the action, when user_id is NULL.';

INSERT INTO schema_migrations (version, name) VALUES (21, '021_audit_unattributed')
ON CONFLICT (version) DO NOTHING;
