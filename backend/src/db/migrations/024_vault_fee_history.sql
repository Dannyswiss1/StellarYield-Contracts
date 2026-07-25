-- #790: Track operator fee rate changes over time
ALTER TABLE vaults
  ADD COLUMN IF NOT EXISTS operator_fee_bps INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS vault_fee_history (
  id          SERIAL PRIMARY KEY,
  vault_id    INT NOT NULL REFERENCES vaults(id),
  old_fee_bps INT NOT NULL,
  new_fee_bps INT NOT NULL,
  changed_by  TEXT NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_fee_history_vault_id
  ON vault_fee_history (vault_id, recorded_at DESC);
