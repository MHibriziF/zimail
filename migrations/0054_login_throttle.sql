-- Failed sign-ins per account, and the lock they earn. Written only on a
-- failure, and once more on the first success after one.
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;

-- Unix epoch milliseconds; NULL when the account has never been locked.
ALTER TABLE users ADD COLUMN locked_until INTEGER;

-- The last authenticator time step accepted, so a code cannot be used twice.
ALTER TABLE users ADD COLUMN totp_last_step INTEGER;
