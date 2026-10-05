-- The display name a message arrived under, kept beside the address.
--
-- Zero's thread pane shows "Grace Hopper" rather than grace@example.com, and
-- re-parsing it out of the stored headers on every render is both slower and
-- lossier than recording it once on the way in.
--
-- Upstream carries this as 0016; ours is 0024.
ALTER TABLE emails ADD COLUMN from_name TEXT;
