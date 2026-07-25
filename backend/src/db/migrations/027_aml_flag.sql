-- Add AML flag columns to users table (Issue #798)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS aml_flagged BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS aml_flagged_at TIMESTAMPTZ;
