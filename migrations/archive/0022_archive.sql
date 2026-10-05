-- Archived conversations stay available without remaining in the inbox.
-- Actions are applied to whole threads, matching the existing read/star/trash
-- behavior, while the timestamp preserves when the conversation was archived.
--
-- Upstream carries this as 0015; the numbers differ because this fork's
-- 0014-0021 were already taken.
ALTER TABLE emails ADD COLUMN archived_at TEXT;

CREATE INDEX idx_emails_archived ON emails(user_id, archived_at);
