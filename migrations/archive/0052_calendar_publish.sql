-- A private iCalendar feed of the user's own calendar, for Google, Apple or
-- Outlook to subscribe to (#170). The token in the link is the only
-- credential, so only its hash is stored; resetting it replaces the row's hash.
--
-- `ics` caches the last file built. Subscribers poll whether or not anything
-- changed, so serving the cache costs one row read; the triggers below clear
-- it whenever an event that would be in the feed is written, and the next
-- fetch rebuilds it. A subscribed calendar's events only clear it when the
-- feed includes them.
CREATE TABLE calendar_publish (
	user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	token_hash TEXT NOT NULL UNIQUE,
	include_feeds INTEGER NOT NULL DEFAULT 0,
	busy_only INTEGER NOT NULL DEFAULT 0,
	ics TEXT,
	built_at TEXT,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TRIGGER calendar_publish_evict_insert AFTER INSERT ON calendar_events
BEGIN
	UPDATE calendar_publish SET ics = NULL, built_at = NULL
	WHERE user_id = NEW.user_id AND ics IS NOT NULL AND (include_feeds = 1 OR NEW.source <> 'feed');
END;

CREATE TRIGGER calendar_publish_evict_update AFTER UPDATE ON calendar_events
BEGIN
	UPDATE calendar_publish SET ics = NULL, built_at = NULL
	WHERE user_id = NEW.user_id AND ics IS NOT NULL AND (include_feeds = 1 OR NEW.source <> 'feed');
END;

CREATE TRIGGER calendar_publish_evict_delete AFTER DELETE ON calendar_events
BEGIN
	UPDATE calendar_publish SET ics = NULL, built_at = NULL
	WHERE user_id = OLD.user_id AND ics IS NOT NULL AND (include_feeds = 1 OR OLD.source <> 'feed');
END;
