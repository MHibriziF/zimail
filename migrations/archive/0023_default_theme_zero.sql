-- Zero becomes the default shell.
--
-- 0020 landed while Classic was the only theme, so its column default — and
-- every row written since — says 'classic'. Accounts that never chose a theme
-- should get the new default; one that did keep what it picked, and there is
-- no way to tell the two apart from the column alone. Existing accounts are
-- therefore left on Classic and only new ones start on Zero, which is the
-- conservative reading: nobody's interface changes under them on upgrade.

-- SQLite cannot alter a column default in place, so the table is left as is
-- and the application default (DEFAULT_UI_THEME) is what new accounts get;
-- `users.ui_theme` is only ever read through getUserUiTheme, which falls back
-- to that constant when the stored value is not a theme we have.
UPDATE users SET ui_theme = 'zero' WHERE ui_theme NOT IN ('zero', 'classic');
