ALTER TABLE vaults
  ADD COLUMN IF NOT EXISTS rwa_name         TEXT,
  ADD COLUMN IF NOT EXISTS rwa_symbol        TEXT,
  ADD COLUMN IF NOT EXISTS rwa_document_uri  TEXT;
