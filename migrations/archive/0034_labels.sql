-- User-defined labels, applied to whole conversations (like Gmail), not single
-- messages: a reply that arrives later is labelled because its conversation is.
-- `conversation_id` is COALESCE(emails.thread_id, emails.id) — the id of the
-- conversation's oldest message, which never changes once assigned.
-- Replaces upstream's 0024_labels.sql (tabs/spam/TypeSafe), which this fork
-- deliberately doesn't port; see issue #28.
CREATE TABLE labels (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	color TEXT NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX labels_user_name_idx ON labels(user_id, name COLLATE NOCASE);

CREATE TABLE conversation_labels (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	conversation_id TEXT NOT NULL,
	label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY (user_id, conversation_id, label_id)
);

CREATE INDEX conversation_labels_label_idx ON conversation_labels(label_id);
