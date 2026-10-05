-- Scheduled send, held by us instead of by the provider.
--
-- 0016 handed `scheduled_at` to Resend and let it release the message. That
-- tied the feature to one provider — Cloudflare Email has no hold-until, so
-- scheduling was simply refused there — and to Resend's 30-day horizon. The
-- message now waits in this table until the cron trigger sends it, so any
-- provider works and the time can be as far out as the sender likes.
--
-- `send_attempts` is what stops a message the provider keeps rejecting from
-- being retried on every tick forever.
ALTER TABLE emails ADD COLUMN send_attempts INTEGER NOT NULL DEFAULT 0;

-- The sweep looks across every user at once, so the 0016 index — which leads
-- with user_id — cannot serve it.
CREATE INDEX idx_emails_due_send ON emails(scheduled_at)
	WHERE status = 'scheduled' AND scheduled_at IS NOT NULL;

-- Anything already scheduled when this runs was handed to Resend under the old
-- design and will be released by Resend, not by us. Moving it to `queued` keeps
-- the new sweep from sending it a second time; its delivery webhook carries it
-- on to sent.
UPDATE emails SET status = 'queued', status_at = datetime('now')
 WHERE status = 'scheduled' AND provider_id IS NOT NULL;
