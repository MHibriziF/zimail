-- The "move old mail to Trash" filter, saved. With sweep_auto on, it runs by itself in the same
-- once-a-day cleanup that empties the Trash (users.last_trash_purge_at). Off until turned on.
ALTER TABLE users ADD COLUMN sweep_auto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN sweep_days INTEGER NOT NULL DEFAULT 90;
ALTER TABLE users ADD COLUMN sweep_only_read INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN sweep_keep_starred INTEGER NOT NULL DEFAULT 1;
