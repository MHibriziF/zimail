-- The zone the mailbox reasons about time in.
--
-- NULL means "whatever this browser says", which is right until you travel or
-- the device clock is set wrong. Stored as an IANA name so it survives DST.
ALTER TABLE users ADD COLUMN timezone TEXT;
