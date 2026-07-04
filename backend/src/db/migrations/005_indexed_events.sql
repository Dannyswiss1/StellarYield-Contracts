CREATE TABLE IF NOT EXISTS indexed_events (
  id              SERIAL PRIMARY KEY,
  ledger          INT NOT NULL,
  tx_hash         TEXT NOT NULL,
  contract_id     TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_indexed_events_contract_event ON indexed_events (contract_id, event_type);
