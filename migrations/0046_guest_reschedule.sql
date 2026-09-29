-- How close to the start a guest may still move or cancel their booking.
ALTER TABLE reservation_pages ADD COLUMN reschedule_cutoff_hours INTEGER NOT NULL DEFAULT 24;

-- The guest's link to change their booking: only its SHA-256 is kept, so the
-- database alone can't be used to act on a booking. Older bookings have none.
ALTER TABLE reservations ADD COLUMN manage_token_hash TEXT;
ALTER TABLE reservations ADD COLUMN reschedule_count INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX reservations_manage_token_idx ON reservations(manage_token_hash) WHERE manage_token_hash IS NOT NULL;
