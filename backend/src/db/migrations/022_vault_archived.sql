-- Add archived column to vaults table for soft-delete support (#674)
ALTER TABLE vaults
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for efficient filtering of archived vaults
CREATE INDEX IF NOT EXISTS idx_vaults_archived_updated_at ON vaults (archived, updated_at DESC);
