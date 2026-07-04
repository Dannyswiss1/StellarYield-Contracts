CREATE TABLE IF NOT EXISTS user_vault_positions (
  id              SERIAL PRIMARY KEY,
  user_address    TEXT NOT NULL,
  vault_id        INT NOT NULL REFERENCES vaults(id),
  shares          NUMERIC DEFAULT 0,
  deposited       NUMERIC DEFAULT 0,
  last_claimed_epoch INT DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_address, vault_id)
);
