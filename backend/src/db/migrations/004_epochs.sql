CREATE TABLE IF NOT EXISTS epochs (
  id              SERIAL PRIMARY KEY,
  vault_id        INT NOT NULL REFERENCES vaults(id),
  epoch           INT NOT NULL,
  yield_amount    NUMERIC NOT NULL,
  total_shares    NUMERIC NOT NULL,
  distributed_at  TIMESTAMPTZ,
  UNIQUE (vault_id, epoch)
);
