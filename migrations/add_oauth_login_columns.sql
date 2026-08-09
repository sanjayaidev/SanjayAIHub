-- Adds Google / GitHub sign-in support to the users table.
-- Safe to run multiple times.

-- OAuth accounts don't have a password.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 'local' | 'google' | 'github'
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'local';

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_google_id_key') THEN
    ALTER TABLE users ADD CONSTRAINT users_google_id_key UNIQUE (google_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_github_id_key') THEN
    ALTER TABLE users ADD CONSTRAINT users_github_id_key UNIQUE (github_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);

-- Existing password-based accounts are implicitly "local" already
-- (column default handles this), nothing else to backfill.
