-- Ask AI conversations, one row each with its turns as JSON: a follow-up question is one
-- UPDATE, not a row per message. The index serves the history list newest first. See #118.
CREATE TABLE ai_conversations (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	title TEXT NOT NULL,
	turns TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ai_conversations_user_idx ON ai_conversations(user_id, updated_at);
