-- Adds the zkMe KYC verifier contract address to vaults.
-- Populated from vault_created events and updated on zkme_upd events.
ALTER TABLE vaults
  ADD COLUMN IF NOT EXISTS zkme_verifier_address TEXT;
