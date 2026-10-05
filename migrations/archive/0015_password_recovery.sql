-- Account recovery.
--
-- The recovery address must live outside this mailbox: a reset link delivered
-- to an address you can only read by logging in is no use when you cannot log
-- in. It is trusted only once verified, so a typo cannot silently redirect
-- future resets to a stranger.
ALTER TABLE users ADD COLUMN recovery_email TEXT;
ALTER TABLE users ADD COLUMN recovery_email_verified_at TEXT;
ALTER TABLE users ADD COLUMN recovery_email_pending TEXT;

-- One table for both link kinds. Tokens are stored hashed, expire, and are
-- spent exactly once.
CREATE TABLE account_tokens (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('password_reset', 'recovery_email')),
	token_hash TEXT NOT NULL UNIQUE,
	expires_at TEXT NOT NULL,
	used_at TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_account_tokens_user ON account_tokens(user_id, kind);
