CREATE TABLE IF NOT EXISTS share_balance_snapshots (
  id              SERIAL PRIMARY KEY,
  user_address    TEXT NOT NULL,
  vault_id        INT NOT NULL REFERENCES vaults(id),
  epoch           INT NOT NULL,
  shares          NUMERIC NOT NULL DEFAULT 0,
  recorded_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_address, vault_id, epoch)
);

CREATE INDEX IF NOT EXISTS idx_share_balance_snapshots_user_vault_epoch
  ON share_balance_snapshots (user_address, vault_id, epoch);

CREATE INDEX IF NOT EXISTS idx_share_balance_snapshots_user_epoch
  ON share_balance_snapshots (user_address, epoch);
