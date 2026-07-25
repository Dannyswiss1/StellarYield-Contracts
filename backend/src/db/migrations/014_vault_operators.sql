-- Stores the set of operators per vault, populated from op_add / op_rem events.
-- assigned_at records when the operator was added (from the on-chain timestamp
-- in the op_add event payload).
CREATE TABLE IF NOT EXISTS vault_operators (
  id           SERIAL PRIMARY KEY,
  vault_id     INT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  address      TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vault_id, address)
);
