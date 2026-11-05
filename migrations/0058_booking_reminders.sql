-- Reminder emails before a booking: 'none', 'hour', 'day' or 'both', per page.
ALTER TABLE reservation_pages ADD COLUMN reminders TEXT NOT NULL DEFAULT 'day';

-- When this booking's next reminder is due (UTC ISO); NULL once none is left.
ALTER TABLE reservations ADD COLUMN next_reminder_at TEXT;

-- Only bookings still waiting on a reminder are indexed, so the per-minute
-- sweep reads just the ones that are due.
CREATE INDEX IF NOT EXISTS reservations_next_reminder_idx
	ON reservations(next_reminder_at) WHERE next_reminder_at IS NOT NULL;

-- Bookings made before this get their day-before reminder too, when it's still ahead.
UPDATE reservations
SET next_reminder_at = strftime('%Y-%m-%dT%H:%M:%fZ', starts_at, '-1 day')
WHERE starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day', '+2 hours');
