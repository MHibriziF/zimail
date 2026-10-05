-- An event the user organizes can have its own Zimail meeting room, like a
-- booking. The room is an ordinary row in `meetings`, owned by the user; the
-- event keeps its join code so the room can be closed with it.
ALTER TABLE calendar_events ADD COLUMN meeting_code TEXT;
