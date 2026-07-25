-- Add fee_revenue and gross_assets columns to redemption_requests to track
-- early redemption fee revenue per processed redemption.
-- Issue #788: Add early redemption fee revenue tracking

ALTER TABLE redemption_requests
  ADD COLUMN IF NOT EXISTS fee_revenue NUMERIC DEFAULT 0;

ALTER TABLE redemption_requests
  ADD COLUMN IF NOT EXISTS gross_assets NUMERIC DEFAULT 0;
