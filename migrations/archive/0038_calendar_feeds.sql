-- External calendars subscribed to by their published iCal address (Google's
-- "secret address in iCal format", Outlook's published ICS, iCloud's public
-- link). Read-only: a sync replaces the feed's rows in calendar_events
-- (source 'feed', source_id = this id), which is what lets busy time elsewhere
-- block reservation slots here.
--
-- `url` is a bearer secret — anyone holding it can read the calendar — so the
-- API never returns it, only its host.
CREATE TABLE calendar_feeds (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	url TEXT NOT NULL,
	color TEXT NOT NULL DEFAULT 'blue',
	event_count INTEGER NOT NULL DEFAULT 0,
	last_attempt_at TEXT,
	last_synced_at TEXT,
	last_error TEXT,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX calendar_feeds_user_idx ON calendar_feeds(user_id);
CREATE INDEX calendar_feeds_attempt_idx ON calendar_feeds(last_attempt_at);
