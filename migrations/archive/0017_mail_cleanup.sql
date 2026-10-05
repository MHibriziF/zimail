-- Mailbox cleanup.
--
-- Trash is emptied lazily rather than on a timer: a purge is claimed at most
-- once a day when the mailbox is next opened. A mailbox nobody opens keeps its
-- trash, which is harmless.
ALTER TABLE users ADD COLUMN trash_retention_days INTEGER NOT NULL DEFAULT 60;
ALTER TABLE users ADD COLUMN last_trash_purge_at TEXT;
