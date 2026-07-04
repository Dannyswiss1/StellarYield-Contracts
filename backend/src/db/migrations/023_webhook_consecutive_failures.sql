-- Migration 023: Add consecutive_failures tracking to webhooks table
-- Required for auto-deactivation after sustained delivery failures (issue #667)

ALTER TABLE webhooks
  ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0;
