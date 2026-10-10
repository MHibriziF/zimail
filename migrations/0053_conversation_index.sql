-- Mailbox queries filter and join on the conversation key COALESCE(thread_id, id), which
-- idx_emails_thread cannot serve, so every thread on a page rescanned all of the user's mail.
CREATE INDEX IF NOT EXISTS idx_emails_conversation ON emails(user_id, COALESCE(thread_id, id));
