-- Invitations the user sends (bookings now, events with guests later) and
-- what their guests answer.
--
-- `sequence` is the revision the guests were last sent: an update or a
-- cancellation must carry a higher one or their calendars ignore it.
ALTER TABLE calendar_events ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0;

-- One row per guest of one of the user's events, with their latest answer
-- ('needs-action', 'accepted', 'tentative', 'declined'), as their calendar
-- replied. Goes when the event does.
CREATE TABLE event_guests (
	event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	email TEXT NOT NULL,
	name TEXT,
	status TEXT NOT NULL DEFAULT 'needs-action',
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY (event_id, email)
);

CREATE INDEX event_guests_user_idx ON event_guests(user_id);

-- Bookings made before this already have their guest, in reservations.
INSERT OR IGNORE INTO event_guests (event_id, user_id, email, name)
SELECT r.event_id, r.user_id, lower(r.guest_email), r.guest_name
FROM reservations r JOIN calendar_events e ON e.id = r.event_id;
