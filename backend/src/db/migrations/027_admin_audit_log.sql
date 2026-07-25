CREATE TABLE IF NOT EXISTS admin_audit_log (
  id               SERIAL PRIMARY KEY,
  api_key_label    TEXT,
  action           TEXT NOT NULL,
  target           TEXT NOT NULL,
  ip_address       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  request_body_hash TEXT NOT NULL
);
