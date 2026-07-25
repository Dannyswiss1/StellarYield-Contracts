-- Add operator_fee_bps column to vaults to store the operator fee in basis points.
-- Used to compute parsed_data fee breakdowns on yield_distributed events.
-- Issue #785: Track operator fee amounts in indexed_events

ALTER TABLE vaults
  ADD COLUMN IF NOT EXISTS operator_fee_bps INT DEFAULT 0;
