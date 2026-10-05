-- Two-factor authentication (TOTP).
--
-- `totp_secret` is written at enrolment but only trusted once `totp_enabled`
-- flips, so an abandoned setup never locks anyone out.
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_enabled_at TEXT;

-- Single-use recovery codes, hashed the same way API tokens are.
CREATE TABLE totp_backup_codes (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	code_hash TEXT NOT NULL,
	used_at TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_backup_codes_user ON totp_backup_codes(user_id);
