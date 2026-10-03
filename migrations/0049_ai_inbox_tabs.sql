-- Sort inbox tabs with Clef on Workers AI instead of the header rules (#153). Off until turned on:
-- it spends the account's Workers AI allowance on incoming mail.
ALTER TABLE users ADD COLUMN ai_inbox_tabs INTEGER NOT NULL DEFAULT 0;
