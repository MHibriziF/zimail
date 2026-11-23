-- How the user has tuned the look: accent, density, text size and font, as JSON.
-- NULL means the defaults, which is what most rows keep.
ALTER TABLE users ADD COLUMN ui_appearance TEXT;
