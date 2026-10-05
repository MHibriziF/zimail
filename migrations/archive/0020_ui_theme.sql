-- Which shell the app renders in.
--
-- Stored on the user rather than only in a cookie so the choice follows the
-- account to another browser, and so the server can pick the right shell for
-- the first paint instead of swapping it after hydration.
--
-- Upstream carries this as 0017; the numbers differ because this fork's
-- 0014-0019 were already taken.
ALTER TABLE users ADD COLUMN ui_theme TEXT NOT NULL DEFAULT 'classic';
