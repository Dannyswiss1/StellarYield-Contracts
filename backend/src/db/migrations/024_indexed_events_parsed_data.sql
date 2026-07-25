-- Add parsed_data JSONB column to indexed_events for storing pre-computed fee
-- breakdowns and other derived fields alongside the raw event payload.
-- Issue #785: Track operator fee amounts in indexed_events

ALTER TABLE indexed_events
  ADD COLUMN IF NOT EXISTS parsed_data JSONB;
