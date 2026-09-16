ALTER TABLE users ADD COLUMN IF NOT EXISTS terminal_access boolean NOT NULL DEFAULT false;
