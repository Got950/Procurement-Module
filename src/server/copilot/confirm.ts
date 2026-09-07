/* eslint-disable @typescript-eslint/no-explicit-any */
import { log } from "@/lib/logger";
import type { CopilotContext } from "@/server/copilot/context";
import {
  cancelConfirmation,
  claimConfirmation,
  finishConfirmation,
  findPriorExecution,
} from "@/server/copilot/confirmations";
import { executeToolCall } from "@/server/copilot/executor";
import { appendMessage } from "@/server/copilot/conversation";
import { systemPrompt } from "@/server/copilot/prompt";
import { ModelUnavailableError, openaiChat, type ChatFn } from "@/server/copilot/llm";
import "@/server/copilot/tools";

export type ConfirmResult = {
  conversationId: string;
  reply: string;
  messageId: string;
  status: "EXECUTED" | "FAILED" | "CANCELLED";
  toolName: string;
  result: any;
  replayed: boolean;
};

/** Plain statement of what the backend reported, used when the model is down. */
function factualSummary(toolName: string, result: any): string {
  const parts = [`Action ${toolName} completed with status ${result?.status ?? "SUCCEEDED"}.`];
  if (result?.reference) parts.push(`Case: ${result.reference}.`);
  if (result?.newStatus) parts.push(`New status: ${result.newStatus}.`);
  if (typeof result?.emailJobsQueued === "number") {
    parts.push(
      `${result.emailJobsQueued} e-mail job(s) queued, ${result.emailJobsSucceeded ?? 0} sent so far.`
    );
  }
  if (result?.sentToEmail) parts.push(`Sent to ${result.sentToEmail}.`);
  return parts.join(" ");
}

async function explain(params: {
  ctx: CopilotContext;
  chat: ChatFn;
  toolName: string;
  outcome: { ok: boolean; payload: any };
  replayed: boolean;
}): Promise<string> {
  const { ctx, outcome } = params;
  const instruction = outcome.ok
    ? "The user confirmed an action and the backend executed it. Report the outcome in one or two sentences using only the fields below. QUEUED means an e-mail job is waiting for the worker, not that mail was delivered."
    : "The user confirmed an action and it FAILED. Tell them plainly that it did not happen and give the reason below. Do not suggest it partly worked.";
  try {
    const response = await params.chat({
      messages: [
        { role: "system", content: systemPrompt(ctx.actor) },
        {
          role: "user",
          content: [
            instruction,
            params.replayed
              ? "This exact action had already been executed moments ago; the stored result is reused and nothing ran twice."
              : "",
            `Tool: ${params.toolName}`,
            `Result: ${JSON.stringify(outcome.payload).slice(0, 2000)}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      tools: [],
      maxOutputTokens: 250,
      disableTools: true,
    });
    const text = response.content?.trim();
    if (text) return text;
  } catch (error) {
    if (!(error instanceof ModelUnavailableError)) throw error;
    log.warn("copilot confirmation explanation fell back to a factual summary");
  }
  return outcome.ok
    ? factualSummary(params.toolName, outcome.payload)
    : `That did not happen: ${outcome.payload?.message ?? "the action failed."}`;
}

/**
 * Executes a consequential action, but only under a confirmation record that is
 * still pending, unexpired and owned by this user and conversation. The claim is
 * atomic, so a replayed confirm finds nothing to claim. Authorization is
 * re-checked at execution time against the current session, not the session that
 * asked.
 */
export async function confirmCopilotAction(params: {
  ctx: CopilotContext;
  confirmationId: string;
  chat?: ChatFn;
}): Promise<ConfirmResult> {
  const { ctx } = params;
  const chat = params.chat ?? openaiChat();
  const row = await claimConfirmation(params.confirmationId, ctx);

  const prior = await findPriorExecution({
    ctx,
    toolName: row.tool_name,
    argsHash: row.args_hash,
    excludeId: row.id,
  });
  if (prior) {
    const payload = { ...(prior.result ?? {}), replayed: true };
    await finishConfirmation({ id: row.id, status: "EXECUTED", result: payload });
    const reply = await explain({
      ctx,
      chat,
      toolName: row.tool_name,
      outcome: { ok: true, payload },
      replayed: true,
    });
    const stored = await appendMessage({
      conversationId: ctx.conversationId,
      role: "assistant",
      content: reply,
      data: { confirmationId: row.id, toolName: row.tool_name, status: "EXECUTED", replayed: true },
    });
    return {
      conversationId: ctx.conversationId,
      reply,
      messageId: stored.id,
      status: "EXECUTED",
      toolName: row.tool_name,
      result: payload,
      replayed: true,
    };
  }

  const outcome = await executeToolCall({
    ctx: { ...ctx, confirmationId: row.id },
    toolName: row.tool_name,
    rawArgs: row.args_json ?? {},
  });

  if (outcome.kind === "ok") {
    await finishConfirmation({ id: row.id, status: "EXECUTED", result: outcome.result });
    const reply = await explain({
      ctx,
      chat,
      toolName: row.tool_name,
      outcome: { ok: true, payload: outcome.result },
      replayed: false,
    });
    const stored = await appendMessage({
      conversationId: ctx.conversationId,
      role: "assistant",
      content: reply,
      data: {
        confirmationId: row.id,
        toolName: row.tool_name,
        status: "EXECUTED",
        result: outcome.result,
      },
    });
    return {
      conversationId: ctx.conversationId,
      reply,
      messageId: stored.id,
      status: "EXECUTED",
      toolName: row.tool_name,
      result: outcome.result,
      replayed: false,
    };
  }

  // A confirmation asking for something that cannot execute (or that the
  // confirming session is not allowed to run) is recorded as failed, never
  // silently retried and never reported as done.
  const failure =
    outcome.kind === "confirmation"
      ? { code: "CONFIRMATION_LOOP", message: "The action could not be executed." }
      : { code: outcome.code, message: outcome.message };
  await finishConfirmation({
    id: row.id,
    status: "FAILED",
    result: failure,
    errorMessage: failure.message,
  });
  const reply = await explain({
    ctx,
    chat,
    toolName: row.tool_name,
    outcome: { ok: false, payload: failure },
    replayed: false,
  });
  const stored = await appendMessage({
    conversationId: ctx.conversationId,
    role: "assistant",
    content: reply,
    data: { confirmationId: row.id, toolName: row.tool_name, status: "FAILED", error: failure },
  });
  return {
    conversationId: ctx.conversationId,
    reply,
    messageId: stored.id,
    status: "FAILED",
    toolName: row.tool_name,
    result: failure,
    replayed: false,
  };
}

export async function cancelCopilotAction(params: {
  ctx: CopilotContext;
  confirmationId: string;
}): Promise<ConfirmResult> {
  await cancelConfirmation(params.confirmationId, params.ctx);
  const reply = "Cancelled. Nothing was sent or changed.";
  const stored = await appendMessage({
    conversationId: params.ctx.conversationId,
    role: "assistant",
    content: reply,
    data: { confirmationId: params.confirmationId, status: "CANCELLED" },
  });
  return {
    conversationId: params.ctx.conversationId,
    reply,
    messageId: stored.id,
    status: "CANCELLED",
    toolName: "",
    result: null,
    replayed: false,
  };
}
