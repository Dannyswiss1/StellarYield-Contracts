ALTER TABLE vault_operators 
ADD COLUMN IF NOT EXISTS expires_at BIGINT;

CREATE INDEX IF NOT EXISTS idx_vault_operators_expires_at ON vault_operators(expires_at);

COMMENT ON COLUMN vault_operators.expires_at IS 'Unix timestamp when operator role expires. NULL means permanent.';
