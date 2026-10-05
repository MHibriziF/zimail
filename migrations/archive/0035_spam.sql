-- A free, local spam folder (issue #28, stage 2) — no classifier service.
-- Spam is a conversation-level state like archiving: set on every message of
-- the conversation, and it takes the mail out of every folder but Spam.
ALTER TABLE emails ADD COLUMN spam_at TIMESTAMP;

-- Senders the user marked as spam. Their later mail is filed straight into
-- Spam; "Not spam" removes them again.
CREATE TABLE blocked_senders (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	address TEXT NOT NULL COLLATE NOCASE,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY (user_id, address)
);
