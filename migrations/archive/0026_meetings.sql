-- A "start a meeting" button in the composer creates a LiveKit room and
-- inserts a join link into the email. The call itself lives entirely in
-- LiveKit Cloud; this table only remembers who hosts each room and the
-- hashed secret that gates the public join page -- anyone with the emailed
-- link joins without a Quickinbox account, so the token (not a login check)
-- is the whole safety boundary, checked (not consumed) on every visit since
-- the same link is shared with and reused by multiple invitees.
CREATE TABLE meetings (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
	title TEXT,
	token_hash TEXT NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX meetings_user_id_idx ON meetings(user_id);
