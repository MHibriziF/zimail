-- Who may share their screen ('open' | 'approval') and whether shares coexist
-- ('single' | 'multiple'). Defaults keep existing meetings behaving as before:
-- anyone can share, and several shares can run at once.
ALTER TABLE meetings ADD COLUMN screen_share_policy TEXT NOT NULL DEFAULT 'open';
ALTER TABLE meetings ADD COLUMN screen_share_mode TEXT NOT NULL DEFAULT 'multiple';
