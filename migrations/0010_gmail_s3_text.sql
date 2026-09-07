-- Expand-only: Gmail message metadata, document S3/text fields, Gmail token cache columns.

CREATE TABLE IF NOT EXISTS gmail_messages (
  gmail_message_id TEXT PRIMARY KEY,
  thread_id TEXT,
  indent_id TEXT,
  from_email TEXT,
  subject TEXT,
  snippet TEXT,
  internal_ms BIGINT,
  attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gmail_messages_indent ON gmail_messages (indent_id, internal_ms DESC);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS s3_key TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_backend TEXT NOT NULL DEFAULT 'fs';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extracted_text TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extracted_hash TEXT;

ALTER TABLE gmail_credentials ADD COLUMN IF NOT EXISTS access_enc TEXT;
ALTER TABLE gmail_credentials ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ;
