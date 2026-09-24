-- A reservation page can give every booking its own Zimail meeting room. The
-- room is an ordinary row in `meetings`, owned by the page's owner; the
-- booking keeps its join code so cancelling can close the room again.
ALTER TABLE reservation_pages ADD COLUMN with_meeting INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reservations ADD COLUMN meeting_code TEXT;
