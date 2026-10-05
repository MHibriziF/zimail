-- Inline images reference a MIME part by its Content-ID (`<img src="cid:…">`).
-- Without the Content-ID stored alongside the file there is nothing to match
-- that reference against, so every inline image rendered broken.
-- Ported from upstream 0022_attachment_content_id.sql; renumbered for this fork.
ALTER TABLE email_attachments ADD COLUMN content_id TEXT;
