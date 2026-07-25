CREATE TABLE IF NOT EXISTS redemption_requests (
  id              SERIAL PRIMARY KEY,
  vault_id        INT NOT NULL REFERENCES vaults(id),
  user_address    TEXT NOT NULL,
  shares          NUMERIC NOT NULL,
  request_time    TIMESTAMPTZ NOT NULL,
  processed       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vault_id, user_address, request_time)
);

CREATE INDEX idx_redemption_requests_vault_processed ON redemption_requests(vault_id, processed);
CREATE INDEX idx_redemption_requests_request_time ON redemption_requests(request_time);
