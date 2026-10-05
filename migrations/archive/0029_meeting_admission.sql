-- Anyone-can-join is the existing behavior and stays the default; opting a
-- meeting into "host must let people in" is a per-meeting choice, not global.
ALTER TABLE meetings ADD COLUMN require_approval INTEGER NOT NULL DEFAULT 0;

-- A pending join request when a meeting requires approval. Short-lived by
-- nature (a meeting session's lifetime) -- no cleanup job needed yet, but see
-- the note in admissions.ts if this table ever grows unbounded.
CREATE TABLE meeting_admissions (
	id TEXT PRIMARY KEY,
	meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX meeting_admissions_meeting_id_idx ON meeting_admissions(meeting_id);
