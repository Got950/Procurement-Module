/* eslint-disable @typescript-eslint/no-explicit-any */
import { query } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { CopilotActor } from "@/server/copilot/context";

/** Only the tail of a conversation is replayed to the model (cost control). */
export const HISTORY_TURNS = 6;

export type ConversationRow = {
  id: string;
  user_id: string;
  title: string | null;
  message_count: number;
  last_active_at: Date;
  created_at: Date;
};

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  data: any;
  createdAt: Date;
};

export async function createConversation(actor: CopilotActor, title: string) {
  const result = await query<ConversationRow>(
    `INSERT INTO copilot_conversations (user_id, title) VALUES ($1, $2) RETURNING *`,
    [actor.id, title.slice(0, 120)]
  );
  return result.rows[0];
}

/**
 * A conversation is owned by exactly one user. Loading another user's
 * conversation is a not-found, so history can never cross accounts even if an
 * id is guessed.
 */
export async function loadOwnedConversation(actor: CopilotActor, conversationId: string) {
  const result = await query<ConversationRow>(
    `SELECT * FROM copilot_conversations WHERE id = $1 AND user_id = $2`,
    [conversationId, actor.id]
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Conversation not found");
  return row;
}

export async function listConversations(actor: CopilotActor, limit = 20) {
  const result = await query<ConversationRow>(
    `SELECT * FROM copilot_conversations WHERE user_id = $1
      ORDER BY last_active_at DESC LIMIT $2`,
    [actor.id, limit]
  );
  return result.rows;
}

export async function appendMessage(params: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  data?: unknown;
}): Promise<StoredMessage> {
  const result = await query<{
    id: string;
    role: "user" | "assistant";
    content: string;
    data_json: any;
    created_at: Date;
  }>(
    `INSERT INTO copilot_messages (conversation_id, role, content, data_json)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, role, content, data_json, created_at`,
    [
      params.conversationId,
      params.role,
      params.content.slice(0, 20_000),
      JSON.stringify(params.data ?? null),
    ]
  );
  await query(
    `UPDATE copilot_conversations
        SET message_count = message_count + 1, last_active_at = NOW()
      WHERE id = $1`,
    [params.conversationId]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    data: row.data_json,
    createdAt: row.created_at,
  };
}

export async function loadMessages(conversationId: string, limit = 100): Promise<StoredMessage[]> {
  const result = await query<{
    id: string;
    role: "user" | "assistant";
    content: string;
    data_json: any;
    created_at: Date;
  }>(
    `SELECT id, role, content, data_json, created_at FROM copilot_messages
      WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT $2`,
    [conversationId, limit]
  );
  return result.rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    data: r.data_json,
    createdAt: r.created_at,
  }));
}

/** The last few turns, oldest first, used to build the model request. */
export async function loadRecentTurns(conversationId: string, turns = HISTORY_TURNS) {
  const result = await query<{ role: "user" | "assistant"; content: string }>(
    `SELECT role, content FROM (
        SELECT role, content, created_at FROM copilot_messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT $2
     ) t ORDER BY created_at ASC`,
    [conversationId, turns * 2]
  );
  return result.rows;
}

export async function recordToolExecution(params: {
  conversationId: string;
  userId: string;
  toolName: string;
  toolKind: string;
  status: "SUCCEEDED" | "FAILED" | "REJECTED" | "CONFIRMATION_REQUIRED" | "TIMEOUT";
  targetType?: string | null;
  targetId?: string | null;
  argsHash?: string | null;
  durationMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  correlationId?: string | null;
}) {
  await query(
    `INSERT INTO copilot_tool_executions
       (conversation_id, user_id, tool_name, tool_kind, status, target_type, target_id,
        args_hash, duration_ms, error_code, error_message, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      params.conversationId,
      params.userId,
      params.toolName,
      params.toolKind,
      params.status,
      params.targetType ?? null,
      params.targetId ?? null,
      params.argsHash ?? null,
      params.durationMs ?? null,
      params.errorCode ?? null,
      // Truncated and never the full argument payload: procurement arguments can
      // carry commercially sensitive values.
      params.errorMessage?.slice(0, 500) ?? null,
      params.correlationId ?? null,
    ]
  );
}

/**
 * Indent references touched earlier in this conversation, so a follow-up like
 * "which one has the highest value?" has something concrete to resolve against
 * without replaying the whole transcript.
 */
export async function recentIndentReferences(conversationId: string, limit = 5) {
  const result = await query<{ id: string; reference: string }>(
    `SELECT DISTINCT ON (i.id) i.id, i.reference
       FROM copilot_tool_executions e
       INNER JOIN indents i
          ON i.id = e.target_id OR upper(i.reference) = upper(e.target_id)
      WHERE e.conversation_id = $1 AND e.target_type = 'indent'
      ORDER BY i.id, e.created_at DESC
      LIMIT $2`,
    [conversationId, limit]
  );
  return result.rows;
}
