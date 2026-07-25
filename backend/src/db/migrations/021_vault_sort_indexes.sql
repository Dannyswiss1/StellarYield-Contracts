-- Composite index on (state, total_assets DESC) for vault sort queries (#655)
CREATE INDEX CONCURRENTLY IF NOT EXISTS vaults_state_assets_idx ON vaults (state, total_assets DESC);

-- Composite index on (vault_id, shares DESC) for holder queries (#656)
-- Backs GET /api/v1/vaults/:contractId/holders?sort=shares which sorts by
-- shares DESC; without this the sort requires a full scan of user_vault_positions.
CREATE INDEX CONCURRENTLY IF NOT EXISTS uvp_vault_shares_idx ON user_vault_positions (vault_id, shares DESC);
