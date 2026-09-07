-- Up Migration
-- Optimistic concurrency for indent edits.
ALTER TABLE indents ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- An approval must be a statement about a specific amount. Without this, the
-- routing amount could be changed after the decision and nothing recorded it.
-- Nullable: historical approvals have no snapshot.
ALTER TABLE approval_events ADD COLUMN IF NOT EXISTS budget_amount_at_decision NUMERIC(18,2);
ALTER TABLE approval_events ADD COLUMN IF NOT EXISTS budget_track_at_decision TEXT;
ALTER TABLE approval_events DROP CONSTRAINT IF EXISTS chk_approval_events_track;
ALTER TABLE approval_events ADD CONSTRAINT chk_approval_events_track
  CHECK (budget_track_at_decision IS NULL OR budget_track_at_decision IN ('TL_ONLY', 'DIRECTOR', 'MD'));

-- The approval-routing amount can never be negative. Left NOT VALID so the
-- migration cannot fail on legacy rows: new and updated rows are enforced, and
-- `VALIDATE CONSTRAINT` follows once a data audit confirms existing rows pass.
ALTER TABLE indents DROP CONSTRAINT IF EXISTS chk_indents_approval_budget_amount;
ALTER TABLE indents ADD CONSTRAINT chk_indents_approval_budget_amount
  CHECK (approval_budget_amount IS NULL OR approval_budget_amount >= 0) NOT VALID;

-- Down Migration
ALTER TABLE indents DROP CONSTRAINT IF EXISTS chk_indents_approval_budget_amount;
ALTER TABLE approval_events DROP CONSTRAINT IF EXISTS chk_approval_events_track;
ALTER TABLE approval_events DROP COLUMN IF EXISTS budget_track_at_decision;
ALTER TABLE approval_events DROP COLUMN IF EXISTS budget_amount_at_decision;
ALTER TABLE indents DROP COLUMN IF EXISTS version;
