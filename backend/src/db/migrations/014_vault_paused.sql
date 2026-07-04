-- Adds paused column to track vault pause/unpause state from on-chain events (#606)
ALTER TABLE vaults
  ADD COLUMN IF NOT EXISTS paused BOOLEAN DEFAULT false;
