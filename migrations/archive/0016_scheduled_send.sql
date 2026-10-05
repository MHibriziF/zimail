-- Scheduled send.
--
-- Delivery is held by the provider, not by us: Resend takes `scheduled_at` and
-- releases the message itself, so nothing here has to run on a timer. The
-- column exists so the mailbox can show when it goes out and offer to cancel.
ALTER TABLE emails ADD COLUMN scheduled_at TEXT;

CREATE INDEX idx_emails_scheduled ON emails(user_id, scheduled_at)
	WHERE scheduled_at IS NOT NULL;
