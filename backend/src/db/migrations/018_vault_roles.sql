CREATE TABLE IF NOT EXISTS vault_roles (
  id              SERIAL PRIMARY KEY,
  vault_id        INT NOT NULL REFERENCES vaults(id),
  user_address    TEXT NOT NULL,
  role            TEXT NOT NULL,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vault_id, user_address, role)
);

CREATE INDEX IF NOT EXISTS idx_vault_roles_vault_id
  ON vault_roles (vault_id);

CREATE INDEX IF NOT EXISTS idx_vault_roles_vault_user
  ON vault_roles (vault_id, user_address);
