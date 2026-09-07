-- Sessions (B-36), document processing metadata (B-43), jobs/outbox (B-21/B-51),
-- Gmail incremental state (B-26), AI cache key (B-32), PO delivery (B-29),
-- audit correlation (B-40). Expand-only: new tables/columns, no drops.

CREATE TABLE IF NOT EXISTS sessions (
  jti TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_refresh ON sessions (refresh_hash) WHERE refresh_hash IS NOT NULL AND revoked_at IS NULL;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS size_bytes INTEGER;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'READY';
ALTER TABLE documents DROP CONSTRAINT IF EXISTS chk_documents_processing;
ALTER TABLE documents ADD CONSTRAINT chk_documents_processing
  CHECK (processing_status IN ('PENDING', 'READY', 'FAILED')) NOT VALID;
ALTER TABLE documents VALIDATE CONSTRAINT chk_documents_processing;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  job_type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_pending ON jobs (run_after) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL,
  route TEXT NOT NULL,
  actor_id TEXT,
  request_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, route)
);

CREATE TABLE IF NOT EXISTS gmail_sync_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  mailbox_email TEXT,
  last_history_id TEXT,
  last_full_sync_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE quotations ADD COLUMN IF NOT EXISTS attribution_status TEXT NOT NULL DEFAULT 'MATCHED';
ALTER TABLE quotations DROP CONSTRAINT IF EXISTS chk_quotations_attribution;
ALTER TABLE quotations ADD CONSTRAINT chk_quotations_attribution
  CHECK (attribution_status IN ('MATCHED', 'UNMATCHED')) NOT VALID;
ALTER TABLE quotations VALIDATE CONSTRAINT chk_quotations_attribution;

ALTER TABLE ai_comparison_runs ADD COLUMN IF NOT EXISTS input_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_comparison_input_hash ON ai_comparison_runs (input_hash) WHERE input_hash IS NOT NULL;

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sent_to_email TEXT;

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip TEXT;
