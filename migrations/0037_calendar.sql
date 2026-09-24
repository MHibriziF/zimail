-- Calendar events. Times are UTC ISO-8601 strings, so they sort and compare as
-- text. An all-day event is a floating date instead: midnight UTC of its first
-- day through midnight UTC of the day after its last, read back as dates in
-- whatever zone is looking rather than converted.
--
-- `source` says who owns the row: 'manual' events are edited in the app;
-- 'feed' (an external calendar subscription) and 'reservation' (a booking)
-- rows are written by those features and are read-only in the editor.
-- `source_id` names the feed or reservation page, `external_uid` the feed's
-- own id for the occurrence.
CREATE TABLE calendar_events (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	source TEXT NOT NULL DEFAULT 'manual',
	source_id TEXT,
	external_uid TEXT,
	title TEXT NOT NULL,
	starts_at TEXT NOT NULL,
	ends_at TEXT NOT NULL,
	all_day INTEGER NOT NULL DEFAULT 0,
	location TEXT,
	notes TEXT,
	busy INTEGER NOT NULL DEFAULT 1,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX calendar_events_user_start_idx ON calendar_events(user_id, starts_at);
CREATE INDEX calendar_events_source_idx ON calendar_events(user_id, source, source_id);
