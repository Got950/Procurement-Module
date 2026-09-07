-- Up Migration
-- Copilot persistence: conversations, messages, tool executions and the
-- server-side confirmation records that bind a consequential action to one
-- user, conversation, argument set and expiry. Expand-only: new tables only.

CREATE TABLE IF NOT EXISTS copilot_conversations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_copilot_conversations_user
  ON copilot_conversations (user_id, last_active_at DESC);

CREATE TABLE IF NOT EXISTS copilot_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id TEXT NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  data_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE copilot_messages DROP CONSTRAINT IF EXISTS chk_copilot_messages_role;
ALTER TABLE copilot_messages ADD CONSTRAINT chk_copilot_messages_role
  CHECK (role IN ('user', 'assistant'));
CREATE INDEX IF NOT EXISTS idx_copilot_messages_conversation
  ON copilot_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS copilot_tool_executions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id TEXT NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  tool_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  args_hash TEXT,
  duration_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_copilot_tool_exec_conversation
  ON copilot_tool_executions (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_copilot_tool_exec_user
  ON copilot_tool_executions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS copilot_confirmations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id TEXT NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  args_json JSONB NOT NULL,
  args_hash TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  preview_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  result_json JSONB,
  error_message TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE copilot_confirmations DROP CONSTRAINT IF EXISTS chk_copilot_confirmations_status;
ALTER TABLE copilot_confirmations ADD CONSTRAINT chk_copilot_confirmations_status
  CHECK (status IN ('PENDING', 'EXECUTING', 'EXECUTED', 'FAILED', 'CANCELLED'));
CREATE INDEX IF NOT EXISTS idx_copilot_confirmations_conversation
  ON copilot_confirmations (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_copilot_confirmations_replay
  ON copilot_confirmations (user_id, tool_name, args_hash, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS copilot_confirmations;
DROP TABLE IF EXISTS copilot_tool_executions;
DROP TABLE IF EXISTS copilot_messages;
DROP TABLE IF EXISTS copilot_conversations;
