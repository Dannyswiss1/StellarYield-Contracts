CREATE TABLE IF NOT EXISTS vaults (
  id              SERIAL PRIMARY KEY,
  contract_id     TEXT NOT NULL UNIQUE,
  factory_id      TEXT,
  asset           TEXT NOT NULL,
  name            TEXT,
  symbol          TEXT,
  state           TEXT NOT NULL DEFAULT 'Funding',
  total_assets    NUMERIC DEFAULT 0,
  total_supply    NUMERIC DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
