-- Signatures are stored as HTML from now on. Until now they were plain text, escaped when shown,
-- so escape the existing ones and turn their line breaks into <br> to keep them looking the same.
UPDATE users
SET email_signature = replace(replace(replace(replace(replace(email_signature, char(13), ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), char(10), '<br>')
WHERE email_signature <> '';

UPDATE addresses
SET signature = replace(replace(replace(replace(replace(signature, char(13), ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), char(10), '<br>')
WHERE signature IS NOT NULL AND signature <> '';
