-- Enable trigram extension for ILIKE / similarity searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index on vault name for fast partial-match queries
CREATE INDEX IF NOT EXISTS idx_vaults_name_trgm ON vaults USING GIN (name gin_trgm_ops);

-- Trigram index on rwa_name for category-scoped text search
CREATE INDEX IF NOT EXISTS idx_vaults_rwa_name_trgm ON vaults USING GIN (rwa_name gin_trgm_ops);

-- Index on state for filter-heavy list queries
CREATE INDEX IF NOT EXISTS idx_vaults_state ON vaults (state);
