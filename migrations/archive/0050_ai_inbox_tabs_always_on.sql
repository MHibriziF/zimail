-- Clef now sorts inbox tabs whenever tabs are on, like Gmail, with no separate switch, so the
-- per-user flag from 0049 goes.
ALTER TABLE users DROP COLUMN ai_inbox_tabs;
