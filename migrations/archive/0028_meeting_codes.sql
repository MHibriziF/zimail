-- The join code is what gets shared and typed now, not a separate hidden token --
-- see meetings.ts. A partial unique index (rather than NOT NULL) lets existing
-- rows keep code = NULL until their owner regenerates one; nothing reads
-- token_hash anymore so it's dropped outright.
ALTER TABLE meetings ADD COLUMN code TEXT;
CREATE UNIQUE INDEX meetings_code_idx ON meetings(code) WHERE code IS NOT NULL;
ALTER TABLE meetings DROP COLUMN token_hash;
