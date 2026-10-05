-- Where a booking takes place, for pages that meet somewhere physical.
ALTER TABLE reservation_pages ADD COLUMN location TEXT;

-- A booking's join link, kept on the booking itself. It used to live only in
-- the calendar event's location, which now holds the physical place when the
-- page has one.
ALTER TABLE reservations ADD COLUMN meeting_url TEXT;

UPDATE reservations
SET meeting_url = (SELECT e.location FROM calendar_events e WHERE e.id = reservations.event_id)
WHERE meeting_code IS NOT NULL;
