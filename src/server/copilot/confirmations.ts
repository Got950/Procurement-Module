/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "crypto";
import { query } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { ConfirmationPreview, CopilotContext } from "@/server/copilot/context";

/** Short window: a confirmation is an answer to the question just asked. */
export const CONFIRMATION_TTL_SECONDS = 300;

/** Window in which an identical confirmed action is treated as a replay. */
const REPLAY_WINDOW_SECONDS = 900;

export type ConfirmationRow = {
  id: string;
  conversation_id: string;
  user_id: string;
  tool_name: string;
  args_json: any;
  args_hash: string;
  target_type: string | null;
  target_id: string | null;
  preview_json: ConfirmationPreview;
  status: string;
  result_json: any;
  error_message: string | null;
  expires_at: Date;
};

export function hashArgs(toolName: string, args: unknown) {
  return createHash("sha256").update(`${toolName}:${JSON.stringify(args ?? {})}`).digest("hex");
}

export async function createConfirmation(params: {
  ctx: CopilotContext;
  toolName: string;
  args: unknown;
  target: { type: string; id: string } | null;
  preview: ConfirmationPreview;
}): Promise<ConfirmationRow> {
  const result = await query<ConfirmationRow>(
    `INSERT INTO copilot_confirmations
       (conversation_id, user_id, tool_name, args_json, args_hash, target_type, target_id,
        preview_json, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, NOW() + make_interval(secs => $9))
     RETURNING *`,
    [
      params.ctx.conversationId,
      params.ctx.actor.id,
      params.toolName,
      JSON.stringify(params.args ?? {}),
      hashArgs(params.toolName, params.args),
      params.target?.type ?? null,
      params.target?.id ?? null,
      JSON.stringify(params.preview),
      CONFIRMATION_TTL_SECONDS,
    ]
  );
  return result.rows[0];
}

/**
 * Takes exclusive ownership of a pending confirmation. The status transition is
 * the whole anti-replay mechanism: a second confirm for the same id matches no
 * row, so it cannot execute the action again. The predicate also pins the
 * record to this user and this conversation, so a confirmation id leaked or
 * guessed elsewhere is useless.
 */
export async function claimConfirmation(
  id: string,
  ctx: CopilotContext
): Promise<ConfirmationRow> {
  const claimed = await query<ConfirmationRow>(
    `UPDATE copilot_confirmations
        SET status = 'EXECUTING', consumed_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND conversation_id = $3
        AND status = 'PENDING'
        AND expires_at > NOW()
      RETURNING *`,
    [id, ctx.actor.id, ctx.conversationId]
  );
  if (claimed.rows[0]) return claimed.rows[0];

  const existing = await query<{ status: string; expires_at: Date }>(
    `SELECT status, expires_at FROM copilot_confirmations
      WHERE id = $1 AND user_id = $2 AND conversation_id = $3`,
    [id, ctx.actor.id, ctx.conversationId]
  );
  const row = existing.rows[0];
  if (!row) throw new NotFoundError("Confirmation not found");
  if (row.status !== "PENDING") {
    throw new ConflictError(
      `This confirmation was already ${row.status.toLowerCase()}. Ask again to start a new one.`
    );
  }
  throw new ConflictError("This confirmation has expired. Ask again to start a new one.");
}

export async function cancelConfirmation(id: string, ctx: CopilotContext) {
  const result = await query<{ id: string }>(
    `UPDATE copilot_confirmations
        SET status = 'CANCELLED', consumed_at = NOW()
      WHERE id = $1 AND user_id = $2 AND conversation_id = $3 AND status = 'PENDING'
      RETURNING id`,
    [id, ctx.actor.id, ctx.conversationId]
  );
  if (!result.rows[0]) throw new ConflictError("This confirmation is no longer pending.");
}

export async function finishConfirmation(params: {
  id: string;
  status: "EXECUTED" | "FAILED";
  result?: unknown;
  errorMessage?: string | null;
}) {
  await query(
    `UPDATE copilot_confirmations
        SET status = $2, result_json = $3::jsonb, error_message = $4
      WHERE id = $1`,
    [
      params.id,
      params.status,
      JSON.stringify(params.result ?? null),
      params.errorMessage?.slice(0, 1000) ?? null,
    ]
  );
}

/**
 * Idempotency at the Copilot layer: an identical action already executed for
 * this user inside the replay window returns the recorded result instead of
 * producing a second external side effect. The workflow's own state guards
 * remain the authoritative protection.
 */
export async function findPriorExecution(params: {
  ctx: CopilotContext;
  toolName: string;
  argsHash: string;
  excludeId: string;
}): Promise<{ id: string; result: any } | null> {
  const result = await query<{ id: string; result_json: any }>(
    `SELECT id, result_json FROM copilot_confirmations
      WHERE user_id = $1
        AND tool_name = $2
        AND args_hash = $3
        AND status = 'EXECUTED'
        AND id <> $4
        AND created_at > NOW() - make_interval(secs => $5)
      ORDER BY created_at DESC
      LIMIT 1`,
    [params.ctx.actor.id, params.toolName, params.argsHash, params.excludeId, REPLAY_WINDOW_SECONDS]
  );
  const row = result.rows[0];
  return row ? { id: row.id, result: row.result_json } : null;
}

export async function loadPendingConfirmationForConversation(ctx: CopilotContext) {
  const result = await query<ConfirmationRow>(
    `SELECT * FROM copilot_confirmations
      WHERE conversation_id = $1 AND user_id = $2 AND status = 'PENDING' AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1`,
    [ctx.conversationId, ctx.actor.id]
  );
  return result.rows[0] ?? null;
}

/** Stale pending records are dropped so an old ask cannot be answered later. */
export async function expirePendingConfirmations(ctx: CopilotContext) {
  await query(
    `UPDATE copilot_confirmations
        SET status = 'CANCELLED', consumed_at = NOW()
      WHERE conversation_id = $1 AND status = 'PENDING' AND expires_at <= NOW()`,
    [ctx.conversationId]
  );
}
