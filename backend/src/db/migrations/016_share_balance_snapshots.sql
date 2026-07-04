-- Snapshots each user's share balance at the close of each epoch.
-- Inserted after every yield_distributed event; idempotent via the unique key.
CREATE TABLE IF NOT EXISTS share_balance_snapshots (
  id           SERIAL PRIMARY KEY,
  vault_id     INT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  user_address TEXT NOT NULL,
  epoch        INT NOT NULL,
  shares       NUMERIC NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vault_id, user_address, epoch)
);
