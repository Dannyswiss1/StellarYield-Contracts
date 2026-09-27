-- StellarYield backend schema

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
  total_shares_ever_minted NUMERIC NOT NULL DEFAULT 0,
  total_shares_ever_burned NUMERIC NOT NULL DEFAULT 0,
  early_redemption_fee_bps INT DEFAULT 0,
  operator_fee_bps INT DEFAULT 0,
  expected_apy    INT,
  maturity_date   TIMESTAMPTZ,
  rwa_category    TEXT,
  description     TEXT,
  logo_uri        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS query_benchmarks (
  id           SERIAL PRIMARY KEY,
  deploy_id    TEXT NOT NULL,
  query_name   TEXT NOT NULL,
  duration_ms  DOUBLE PRECISION NOT NULL,
  run_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (deploy_id, query_name)
);

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  address         TEXT NOT NULL UNIQUE,
  kyc_verified    BOOLEAN DEFAULT FALSE,
  aml_flagged     BOOLEAN NOT NULL DEFAULT FALSE,
  aml_flagged_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS epochs (
  id              SERIAL PRIMARY KEY,
  vault_id        INT NOT NULL REFERENCES vaults(id),
  epoch           INT NOT NULL,
  yield_amount    NUMERIC NOT NULL,
  total_shares    NUMERIC NOT NULL,
  distributed_at  TIMESTAMPTZ,
  UNIQUE (vault_id, epoch)
);

CREATE TABLE IF NOT EXISTS indexed_events (
  id              SERIAL PRIMARY KEY,
  ledger          INT NOT NULL,
  tx_hash         TEXT NOT NULL,
  contract_id     TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS indexer_state (
  id              SERIAL PRIMARY KEY,
  last_ledger     INT NOT NULL DEFAULT 0,
  start_ledger    INT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhooks (
  id              SERIAL PRIMARY KEY,
  url             TEXT NOT NULL,
  events          TEXT[] NOT NULL,
  secret          TEXT,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  channel         TEXT DEFAULT 'webhook',
  consecutive_failures INT DEFAULT 0,
  priority        INT DEFAULT 0,
  fallback_channel INT
);

CREATE TABLE IF NOT EXISTS api_keys (
  id         SERIAL PRIMARY KEY,
  key_hash   TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL DEFAULT 'admin',
  label      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id               SERIAL PRIMARY KEY,
  api_key_label    TEXT,
  action           TEXT NOT NULL,
  target           TEXT NOT NULL,
  ip_address       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  request_body_hash TEXT NOT NULL
);

-- Feature flags for gradual rollout (#916)
CREATE TABLE IF NOT EXISTS feature_flags (
  name               TEXT PRIMARY KEY,
  enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_for_roles  TEXT[] NOT NULL DEFAULT '{}',
  rollout_percent    INT NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Transfers tracking (#1113)
CREATE TABLE IF NOT EXISTS transfers (
  id              SERIAL PRIMARY KEY,
  vault_id        INT REFERENCES vaults(id),
  from_address    TEXT NOT NULL,
  to_address      TEXT NOT NULL,
  amount          NUMERIC NOT NULL,
  tx_hash         TEXT,
  ledger          INT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Transfer alerts (#1077, #1078)
CREATE TABLE IF NOT EXISTS transfer_alerts (
  id              SERIAL PRIMARY KEY,
  vault_id        INT REFERENCES vaults(id),
  contract_id     TEXT,
  type            TEXT NOT NULL,
  amount          NUMERIC,
  from_address    TEXT,
  to_address      TEXT,
  tx_hash         TEXT,
  details         JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ
);

-- Transfer fees (#1076)
CREATE TABLE IF NOT EXISTS transfer_fees (
  id              SERIAL PRIMARY KEY,
  contract_id     TEXT NOT NULL,
  from_address    TEXT NOT NULL,
  to_address      TEXT NOT NULL,
  fee_amount      NUMERIC NOT NULL,
  tx_hash         TEXT,
  ledger          INT,
  fee_type        TEXT DEFAULT 'transfer_fee',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  collected_at    TIMESTAMPTZ DEFAULT NOW()
);

