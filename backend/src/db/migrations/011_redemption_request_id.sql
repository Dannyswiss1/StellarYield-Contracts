ALTER TABLE redemption_requests ADD COLUMN IF NOT EXISTS request_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_redemption_requests_vault_request ON redemption_requests(vault_id, request_id);
