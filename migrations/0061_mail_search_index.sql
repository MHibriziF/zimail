-- Full-text search over mail: words and prefixes instead of a LIKE scan of every message.
-- A regular FTS5 table (it keeps its own copy of the text) rather than external content
-- over `emails`, so a match always carries the real email id and can never point at
-- the wrong message. Drafts are left out: they autosave often and search skips them.
-- The body is capped at 20,000 characters, which keeps long newsletters from
-- dominating the index's size.
CREATE VIRTUAL TABLE emails_fts USING fts5(
	email_id UNINDEXED,
	subject,
	sender,
	recipients,
	body,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);

-- Mail that already exists is indexed a batch at a time by the cron (search-index.ts),
-- up to the newest message at the time of this migration; newer mail goes in through
-- the triggers below. Until `ready`, search keeps using the LIKE scan.
CREATE TABLE search_index_state (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	backfill_max INTEGER NOT NULL,
	cursor INTEGER NOT NULL DEFAULT 0,
	ready INTEGER NOT NULL DEFAULT 0
);

INSERT INTO search_index_state (id, backfill_max, cursor, ready)
SELECT 1, COALESCE(MAX(rowid), 0), 0, CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM emails;

CREATE TRIGGER emails_fts_insert AFTER INSERT ON emails
WHEN NEW.status IS NOT 'draft'
BEGIN
	INSERT OR REPLACE INTO emails_fts (rowid, email_id, subject, sender, recipients, body)
	VALUES (
		NEW.rowid,
		NEW.id,
		NEW.subject,
		COALESCE(NEW.from_name, '') || ' ' || NEW.from_addr,
		NEW.to_addr || ' ' || COALESCE(NEW.cc_addr, ''),
		substr(COALESCE(NEW.body_text, ''), 1, 20000)
	);
END;

-- Only the indexed columns (and status, for a draft becoming real mail) fire this,
-- so marking read, starring or archiving writes nothing to the index.
CREATE TRIGGER emails_fts_update AFTER UPDATE OF subject, from_name, from_addr, to_addr, cc_addr, body_text, status ON emails
BEGIN
	DELETE FROM emails_fts WHERE rowid = OLD.rowid;
	INSERT OR REPLACE INTO emails_fts (rowid, email_id, subject, sender, recipients, body)
	SELECT
		NEW.rowid,
		NEW.id,
		NEW.subject,
		COALESCE(NEW.from_name, '') || ' ' || NEW.from_addr,
		NEW.to_addr || ' ' || COALESCE(NEW.cc_addr, ''),
		substr(COALESCE(NEW.body_text, ''), 1, 20000)
	WHERE NEW.status IS NOT 'draft';
END;

CREATE TRIGGER emails_fts_delete AFTER DELETE ON emails
BEGIN
	DELETE FROM emails_fts WHERE rowid = OLD.rowid;
END;
