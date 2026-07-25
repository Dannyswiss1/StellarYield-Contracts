ALTER TABLE vaults
  ADD COLUMN IF NOT EXISTS funding_target      NUMERIC,
  ADD COLUMN IF NOT EXISTS funding_deadline    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS min_deposit         NUMERIC,
  ADD COLUMN IF NOT EXISTS max_deposit_per_user NUMERIC;
