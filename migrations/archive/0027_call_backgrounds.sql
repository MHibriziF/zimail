-- A small saved gallery of virtual-background images per user, so a custom
-- upload survives a reload or rejoin instead of dying with the blob: URL it
-- started as. Mirrors email_attachments: bytes in R2, this row just points
-- at them. Capped client-side (MAX_CALL_BACKGROUNDS_PER_USER) by dropping the
-- oldest row on insert rather than rejecting the upload.
CREATE TABLE call_backgrounds (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	storage_key TEXT NOT NULL,
	content_type TEXT NOT NULL,
	size_bytes INTEGER NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX call_backgrounds_user_id_idx ON call_backgrounds(user_id);
