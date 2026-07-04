CREATE TABLE IF NOT EXISTS api_keys (
  id         SERIAL PRIMARY KEY,
  key_hash   TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'readonly')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
