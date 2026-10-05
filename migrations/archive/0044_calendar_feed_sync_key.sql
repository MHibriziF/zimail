-- What the last full sync was computed from: a hash of the feed text, the day
-- and the owner's time zone. A refresh that produces the same key skips parsing
-- and the event diff, so an unchanged feed costs one row instead of a read of
-- every stored event.
ALTER TABLE calendar_feeds ADD COLUMN sync_key TEXT;
