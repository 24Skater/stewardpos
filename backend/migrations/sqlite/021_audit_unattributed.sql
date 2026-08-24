-- Counterpart to the Postgres migration of the same number; see that file for
-- why an audit row may legitimately have no user.
--
-- SQLite cannot drop a NOT NULL constraint in place, so the table is rebuilt.
-- The column list is written out rather than `SELECT *` so the copy does not
-- depend on the physical column order, which differs between a database built
-- from 001 and one that reached this shape through 014's ALTER. Dropping the
-- old table drops its indexes with it, which is why they are recreated here
-- under their original names.
CREATE TABLE audit_logs_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  timestamp INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before TEXT,
  after TEXT,
  org_id TEXT REFERENCES organizations(id),
  -- See the Postgres migration: names a caller that is not a person.
  actor_label TEXT
);

INSERT INTO audit_logs_new (id, timestamp, user_id, action, entity, entity_id, before, after, org_id)
  SELECT id, timestamp, user_id, action, entity, entity_id, before, after, org_id FROM audit_logs;

DROP TABLE audit_logs;

ALTER TABLE audit_logs_new RENAME TO audit_logs;

CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX idx_audit_logs_org ON audit_logs(org_id);

INSERT INTO schema_migrations (version, name) VALUES (21, '021_audit_unattributed');
