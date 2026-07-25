CREATE TABLE IF NOT EXISTS indexed_events (
  id SERIAL PRIMARY KEY,
  ledger INTEGER NOT NULL,
  transaction_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  event_data JSONB NOT NULL,
  indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(transaction_hash, contract_id, event_type)
);

CREATE INDEX idx_indexed_events_ledger ON indexed_events(ledger);
CREATE INDEX idx_indexed_events_contract_id ON indexed_events(contract_id);
CREATE INDEX idx_indexed_events_event_type ON indexed_events(event_type);
CREATE INDEX idx_indexed_events_indexed_at ON indexed_events(indexed_at);

CREATE TABLE IF NOT EXISTS vaults (
  contract_id TEXT PRIMARY KEY,
  asset_address TEXT NOT NULL,
  admin_address TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'Funding',
  expected_apy INTEGER NOT NULL,
  maturity_date BIGINT NOT NULL,
  funding_deadline BIGINT NOT NULL,
  min_deposit BIGINT NOT NULL,
  max_deposit BIGINT NOT NULL,
  total_deposits BIGINT DEFAULT 0,
  total_shares BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_vaults_state ON vaults(state);
CREATE INDEX idx_vaults_admin ON vaults(admin_address);

CREATE TABLE IF NOT EXISTS users (
  address TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_deposits (
  id SERIAL PRIMARY KEY,
  vault_contract_id TEXT NOT NULL REFERENCES vaults(contract_id),
  user_address TEXT NOT NULL REFERENCES users(address),
  amount BIGINT NOT NULL,
  shares BIGINT NOT NULL,
  deposited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vault_contract_id, user_address)
);

CREATE INDEX idx_user_deposits_vault ON user_deposits(vault_contract_id);
CREATE INDEX idx_user_deposits_user ON user_deposits(user_address);

CREATE TABLE IF NOT EXISTS yield_distributions (
  id SERIAL PRIMARY KEY,
  vault_contract_id TEXT NOT NULL REFERENCES vaults(contract_id),
  epoch INTEGER NOT NULL,
  total_yield BIGINT NOT NULL,
  total_shares_snapshot BIGINT NOT NULL,
  distributed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vault_contract_id, epoch)
);

CREATE INDEX idx_yield_distributions_vault ON yield_distributions(vault_contract_id);

CREATE TABLE IF NOT EXISTS yield_history (
  id SERIAL PRIMARY KEY,
  vault_contract_id TEXT NOT NULL REFERENCES vaults(contract_id),
  user_address TEXT NOT NULL REFERENCES users(address),
  epoch INTEGER NOT NULL,
  yield_amount BIGINT NOT NULL,
  claimed BOOLEAN DEFAULT FALSE,
  claimed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vault_contract_id, user_address, epoch)
);

CREATE INDEX idx_yield_history_vault_user ON yield_history(vault_contract_id, user_address);
CREATE INDEX idx_yield_history_claimed ON yield_history(claimed);

CREATE TABLE IF NOT EXISTS vault_operators (
  id SERIAL PRIMARY KEY,
  vault_contract_id TEXT NOT NULL REFERENCES vaults(contract_id),
  operator_address TEXT NOT NULL,
  role TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vault_contract_id, operator_address, role)
);

CREATE INDEX idx_vault_operators_vault ON vault_operators(vault_contract_id);
CREATE INDEX idx_vault_operators_address ON vault_operators(operator_address);
CREATE INDEX idx_vault_operators_active ON vault_operators(active);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  vault_contract_id TEXT NOT NULL REFERENCES vaults(contract_id),
  action TEXT NOT NULL,
  actor_address TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_log_vault ON audit_log(vault_contract_id);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_address);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  events TEXT[] NOT NULL,
  secret TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS indexer_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO indexer_state (key, value) VALUES ('last_ledger', '0') ON CONFLICT (key) DO NOTHING;
