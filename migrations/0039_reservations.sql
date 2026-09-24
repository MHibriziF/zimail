-- Public booking pages: a date window, daily hours and a slot length. Guests
-- see only which slots are free — never the events that make the rest busy.
-- `time_zone` is the owner's zone when the page was made; the hours are read
-- in it, whoever is looking.
CREATE TABLE reservation_pages (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	slug TEXT NOT NULL,
	title TEXT NOT NULL,
	description TEXT,
	time_zone TEXT NOT NULL,
	-- Inclusive YYYY-MM-DD dates.
	start_date TEXT NOT NULL,
	end_date TEXT NOT NULL,
	-- Comma-separated weekday numbers, 0 = Sunday.
	weekdays TEXT NOT NULL,
	-- Minutes after midnight.
	day_start INTEGER NOT NULL,
	day_end INTEGER NOT NULL,
	slot_minutes INTEGER NOT NULL,
	buffer_minutes INTEGER NOT NULL DEFAULT 0,
	notice_minutes INTEGER NOT NULL DEFAULT 0,
	active INTEGER NOT NULL DEFAULT 1,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX reservation_pages_slug_idx ON reservation_pages(slug COLLATE NOCASE);
CREATE INDEX reservation_pages_user_idx ON reservation_pages(user_id);

-- One row per booking, beside the calendar_events row (source 'reservation')
-- that makes it block time. The unique start per page is the backstop against
-- two guests taking the same slot at once: both inserts run in one batch with
-- the event, so the loser's whole booking rolls back.
CREATE TABLE reservations (
	id TEXT PRIMARY KEY,
	page_id TEXT NOT NULL REFERENCES reservation_pages(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	event_id TEXT NOT NULL,
	guest_name TEXT NOT NULL,
	guest_email TEXT NOT NULL,
	note TEXT,
	starts_at TEXT NOT NULL,
	ends_at TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX reservations_page_start_idx ON reservations(page_id, starts_at);
CREATE INDEX reservations_event_idx ON reservations(event_id);
CREATE INDEX reservations_page_created_idx ON reservations(page_id, created_at);
