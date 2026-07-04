CREATE TABLE IF NOT EXISTS indexer_state (
  id              SERIAL PRIMARY KEY,
  last_ledger     INT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO indexer_state (last_ledger)
SELECT 0
WHERE NOT EXISTS (SELECT 1 FROM indexer_state);
