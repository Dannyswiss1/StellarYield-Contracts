-- Adds columns required by the early-redemption-fee preview (#589) and the
-- CSV export (#591) endpoints.
--   early_redemption_fee_bps - fee charged on early redemptions, in basis points
--   expected_apy             - advertised annual percentage yield, in basis points
--   maturity_date            - date the vault is expected to mature
ALTER TABLE vaults
  ADD COLUMN IF NOT EXISTS early_redemption_fee_bps INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_apy             INT,
  ADD COLUMN IF NOT EXISTS maturity_date            TIMESTAMPTZ;
