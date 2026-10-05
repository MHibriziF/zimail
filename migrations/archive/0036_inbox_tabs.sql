-- Inbox tabs sorted by local rules (issue #28, stage 3) — no classifier service.
-- NULL means Primary, so mail that arrived before this sorts as Primary until
-- the user backfills or moves it.
ALTER TABLE emails ADD COLUMN category TEXT;

-- "Move to tab" remembers the sender, so their next mail lands there directly.
CREATE TABLE sender_categories (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	address TEXT NOT NULL COLLATE NOCASE,
	category TEXT NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY (user_id, address)
);

-- Tabs are on by default; switching them off shows the whole inbox in one list.
ALTER TABLE users ADD COLUMN inbox_tabs INTEGER NOT NULL DEFAULT 1;
