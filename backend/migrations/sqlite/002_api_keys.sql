-- Migration: Add API Keys table for external integrations
-- Version: 2

-- API Keys Table
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  description TEXT,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT DEFAULT '["read"]',
  rate_limit INTEGER DEFAULT 1000,
  is_active INTEGER DEFAULT 1,
  last_used_at INTEGER,
  expires_at INTEGER,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys(created_by);

-- Insert migration record
INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (2, '002_api_keys');

