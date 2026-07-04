ALTER TABLE user_vault_positions
  ADD COLUMN IF NOT EXISTS last_claimed_epoch INT DEFAULT 0;
