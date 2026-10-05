-- UI language preference (en / fr / zh-CN / es).
--
-- On the user rather than only in a cookie, for the same reason as `ui_theme`:
-- the choice follows the account, and the server can render the first response
-- in the right language instead of switching after hydration.
--
-- Upstream carries this as 0018; the numbers differ because this fork's
-- 0014-0019 were already taken.
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
