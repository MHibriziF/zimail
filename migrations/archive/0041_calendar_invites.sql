-- Invitations the user received (iTIP REQUEST), by the organizer's UID. Their
-- occurrences sit in calendar_events as source 'invite' (source_id = uid,
-- external_uid = the occurrence), read-only like feed events.
--
-- `sequence` is the newest revision applied: an older invitation opened later
-- must not undo a newer one. `response` is the user's answer ('accepted',
-- 'tentative', 'declined'), or NULL when it was added without answering.
-- A row here is also what lets later updates and cancellations from the
-- organizer apply on arrival; an invitation never opened isn't touched.
CREATE TABLE calendar_invites (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	uid TEXT NOT NULL,
	sequence INTEGER NOT NULL DEFAULT 0,
	response TEXT,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY (user_id, uid)
);
