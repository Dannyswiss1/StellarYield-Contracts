CREATE TABLE IF NOT EXISTS vault_operators (
  id              SERIAL PRIMARY KEY,
  vault_id        INT NOT NULL REFERENCES vaults(id),
  operator        TEXT NOT NULL,
  added_by        TEXT NOT NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at      TIMESTAMPTZ,
  removed_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vault_id, operator)
);

CREATE INDEX IF NOT EXISTS idx_vault_operators_vault_id
  ON vault_operators (vault_id);

CREATE INDEX IF NOT EXISTS idx_vault_operators_vault_operator
  ON vault_operators (vault_id, operator);
