-- The room settings each booking's meeting is opened with; NULL means the defaults.
ALTER TABLE reservation_pages ADD COLUMN room_settings TEXT;

-- Guests wait until the host has joined once.
ALTER TABLE meetings ADD COLUMN wait_for_host INTEGER NOT NULL DEFAULT 0;
-- When the host first joined; written once, and only for rooms that wait for the host.
ALTER TABLE meetings ADD COLUMN started_at TEXT;

-- When the room is booked for, as ISO instants; NULL for rooms with no schedule.
ALTER TABLE meetings ADD COLUMN scheduled_start TEXT;
ALTER TABLE meetings ADD COLUMN scheduled_end TEXT;
