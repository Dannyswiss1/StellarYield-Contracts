CREATE TABLE IF NOT EXISTS vault_tvl_snapshots (
  id              SERIAL PRIMARY KEY,
  vault_id        INT NOT NULL REFERENCES vaults(id),
  total_assets    NUMERIC NOT NULL,
  total_supply    NUMERIC NOT NULL,
  recorded_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_tvl_snapshots_vault_id_recorded_at 
  ON vault_tvl_snapshots(vault_id, recorded_at);
