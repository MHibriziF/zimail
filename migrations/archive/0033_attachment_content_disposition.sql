-- Forwarding needs the original MIME disposition so inline parts stay inline
-- and ordinary files stay attachments. content_id already exists from 0032.
-- Ported from upstream 0023_attachment_content_disposition.sql; renumbered for this fork.
ALTER TABLE email_attachments ADD COLUMN content_disposition TEXT;
