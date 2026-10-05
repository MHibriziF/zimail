-- Live captions and a transcript (#149), off until the host allows them. Speech
-- is transcribed by Workers AI, so this is also what lets a meeting spend neurons.
ALTER TABLE meetings ADD COLUMN captions_enabled INTEGER NOT NULL DEFAULT 0;
