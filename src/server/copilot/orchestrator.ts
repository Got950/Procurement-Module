import { log } from "@/lib/logger";
import { emitMetric } from "@/lib/metrics";
import type {
  ConfirmationPreview,
  CopilotClientAction,
  CopilotContext,
  ResourceRef,
} from "@/server/copilot/context";
import { toolSpecsForRole } from "@/server/copilot/tool-registry";
import { executeToolCall } from "@/server/copilot/executor";
import { hashArgs } from "@/server/copilot/confirmations";
import {
  appendMessage,
  loadRecentTurns,
  recentIndentReferences,
} from "@/server/copilot/conversation";
import { contextPrompt, systemPrompt, COPILOT_PROMPT_VERSION } from "@/server/copilot/prompt";
import {
  ModelUnavailableError,
  openaiChat,
  type ChatFn,
  type ChatMessage,
} from "@/server/copilot/llm";
import "@/server/copilot/tools";

/** Hard ceilings. Nothing in a turn may exceed these, whatever the model asks for. */
export const LIMITS = {
  maxIterations: 4,
  maxToolCalls: 6,
  maxToolCallsPerIteration: 3,
  maxInvalidToolCalls: 2,
  maxDuplicateToolCalls: 1,
  maxOutputTokens: 700,
  maxToolResultChars: 6000,
  requestTimeoutMs: 60_000,
  maxUserMessageChars: 2000,
};

export type CopilotToolStatus = {
  name: string;
  status: "ok" | "error" | "confirmation";
  durationMs?: number;
  message?: string;
};

export type PendingConfirmation = {
  confirmationId: string;
  toolName: string;
  preview: ConfirmationPreview;
};

export type CopilotTurn = {
  conversationId: string;
  reply: string;
  messageId: string;
  toolCalls: CopilotToolStatus[];
  references: ResourceRef[];
  clientActions: CopilotClientAction[];
  pendingConfirmation: PendingConfirmation | null;
  model: string | null;
  promptVersion: string;
  usage: { promptTokens: number; completionTokens: number } | null;
  stopReason: "completed" | "iteration_limit" | "tool_limit" | "loop_guard" | "timeout";
};

function serializeToolResult(value: unknown) {
  const json = JSON.stringify(value ?? null);
  if (json.length <= LIMITS.maxToolResultChars) return json;
  return `${json.slice(0, LIMITS.maxToolResultChars)}\n[truncated: ask for a narrower query]`;
}

function deadlineExceeded(startedAt: number) {
  return Date.now() - startedAt > LIMITS.requestTimeoutMs;
}

/** Only same-origin app paths may be returned to the browser. */
function extractClientAction(result: unknown): CopilotClientAction | null {
  if (!result || typeof result !== "object") return null;
  const action = (result as { clientAction?: unknown }).clientAction;
  if (!action || typeof action !== "object") return null;
  const typed = action as CopilotClientAction;
  if (typed.type === "download" && typeof typed.url === "string" && typed.url.startsWith("/")) {
    return {
      type: "download",
      url: typed.url,
      filename: typeof typed.filename === "string" ? typed.filename : "download",
    };
  }
  if (typed.type === "navigate" && typeof typed.href === "string" && typed.href.startsWith("/")) {
    return { type: "navigate", href: typed.href };
  }
  return null;
}

async function buildBaseMessages(ctx: CopilotContext): Promise<ChatMessage[]> {
  // History already includes the user turn just persisted for this request.
  // Do not append it again — that would double-bill tokens and confuse tools.
  const [history, references] = await Promise.all([
    loadRecentTurns(ctx.conversationId),
    recentIndentReferences(ctx.conversationId),
  ]);
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt(ctx.actor) }];
  const context = contextPrompt(references);
  if (context) messages.push({ role: "system", content: context });
  for (const turn of history) {
    messages.push(
      turn.role === "user"
        ? { role: "user", content: turn.content }
        : { role: "assistant", content: turn.content }
    );
  }
  return messages;
}

/**
 * One user turn: bounded model/tool loop, then a persisted assistant message.
 *
 * The loop is not autonomous. It stops on an answer, on the iteration or tool
 * budget, on repeated identical or malformed tool calls, on the request
 * deadline, and always at the first consequential action, which becomes a
 * confirmation the user has to approve.
 */
export async function runCopilotTurn(params: {
  ctx: CopilotContext;
  userMessage: string;
  chat?: ChatFn;
}): Promise<CopilotTurn> {
  const { ctx } = params;
  const chat = params.chat ?? openaiChat();
  const startedAt = Date.now();
  const userMessage = params.userMessage.trim().slice(0, LIMITS.maxUserMessageChars);

  await appendMessage({ conversationId: ctx.conversationId, role: "user", content: userMessage });

  const messages = await buildBaseMessages(ctx);
  const toolSpecs = toolSpecsForRole(ctx.actor.role);
  const toolStatuses: CopilotToolStatus[] = [];
  const references: ResourceRef[] = [];
  const clientActions: CopilotClientAction[] = [];
  const seenCalls = new Map<string, number>();
  let pendingConfirmation: PendingConfirmation | null = null;
  let totalToolCalls = 0;
  let invalidToolCalls = 0;
  let duplicateToolCalls = 0;
  let model: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  let stopReason: CopilotTurn["stopReason"] = "completed";
  let reply: string | null = null;

  for (let iteration = 0; iteration < LIMITS.maxIterations; iteration++) {
    if (deadlineExceeded(startedAt)) {
      stopReason = "timeout";
      break;
    }
    const noMoreTools =
      totalToolCalls >= LIMITS.maxToolCalls ||
      invalidToolCalls >= LIMITS.maxInvalidToolCalls ||
      duplicateToolCalls > LIMITS.maxDuplicateToolCalls ||
      pendingConfirmation !== null;

    let response;
    try {
      response = await chat({
        messages,
        tools: toolSpecs,
        maxOutputTokens: LIMITS.maxOutputTokens,
        disableTools: noMoreTools,
      });
    } catch (error) {
      if (error instanceof ModelUnavailableError) {
        const message =
          "I could not reach the language model, so I cannot answer this right now. Nothing was changed.";
        const stored = await appendMessage({
          conversationId: ctx.conversationId,
          role: "assistant",
          content: message,
          data: { error: "MODEL_UNAVAILABLE", toolCalls: toolStatuses },
        });
        log.error("copilot model unavailable", {
          conversationId: ctx.conversationId,
          error: error.message,
        });
        return {
          conversationId: ctx.conversationId,
          reply: message,
          messageId: stored.id,
          toolCalls: toolStatuses,
          references,
          clientActions: [],
          pendingConfirmation: null,
          model: null,
          promptVersion: COPILOT_PROMPT_VERSION,
          usage: null,
          stopReason: "completed",
        };
      }
      throw error;
    }

    model = response.model;
    if (response.usage) {
      promptTokens += response.usage.promptTokens;
      completionTokens += response.usage.completionTokens;
    }

    if (!response.toolCalls.length) {
      reply = response.content?.trim() || null;
      break;
    }

    messages.push({
      role: "assistant",
      content: response.content ?? "",
      toolCalls: response.toolCalls,
    });

    const calls = response.toolCalls.slice(0, LIMITS.maxToolCallsPerIteration);
    for (const call of calls) {
      if (totalToolCalls >= LIMITS.maxToolCalls) {
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ error: "TOOL_BUDGET_EXHAUSTED" }),
        });
        stopReason = "tool_limit";
        continue;
      }
      if (pendingConfirmation) {
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            error: "AWAITING_CONFIRMATION",
            message: "Ask the user to confirm the pending action before doing anything else.",
          }),
        });
        continue;
      }

      const signature = hashArgs(call.name, call.argumentsJson);
      const repeats = seenCalls.get(signature) ?? 0;
      seenCalls.set(signature, repeats + 1);
      if (repeats > 0) {
        duplicateToolCalls += 1;
        stopReason = "loop_guard";
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            error: "DUPLICATE_CALL",
            message:
              "You already called this tool with these arguments in this turn. Use the earlier result.",
          }),
        });
        continue;
      }

      totalToolCalls += 1;
      const outcome = await executeToolCall({
        ctx,
        toolName: call.name,
        rawArgs: call.argumentsJson,
      });

      if (outcome.kind === "ok") {
        references.push(...outcome.references);
        const clientAction = extractClientAction(outcome.result);
        if (clientAction) clientActions.push(clientAction);
        toolStatuses.push({
          name: outcome.toolName,
          status: "ok",
          durationMs: outcome.durationMs,
        });
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: serializeToolResult(outcome.result),
        });
        continue;
      }

      if (outcome.kind === "confirmation") {
        pendingConfirmation = {
          confirmationId: outcome.confirmationId,
          toolName: outcome.toolName,
          preview: outcome.preview,
        };
        toolStatuses.push({ name: outcome.toolName, status: "confirmation" });
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            status: "CONFIRMATION_REQUIRED",
            message:
              "Nothing has happened yet. Describe this action to the user and ask them to confirm it.",
            preview: outcome.preview,
          }),
        });
        continue;
      }

      if (outcome.code === "INVALID_ARGUMENTS" || outcome.code === "UNKNOWN_TOOL") {
        invalidToolCalls += 1;
      }
      toolStatuses.push({ name: outcome.toolName, status: "error", message: outcome.message });
      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify({ error: outcome.code, message: outcome.message }),
      });
    }

    if (iteration === LIMITS.maxIterations - 1) stopReason = "iteration_limit";
  }

  if (!reply) {
    reply = pendingConfirmation
      ? confirmationFallbackText(pendingConfirmation)
      : fallbackText(stopReason, toolStatuses);
  }

  const stored = await appendMessage({
    conversationId: ctx.conversationId,
    role: "assistant",
    content: reply,
    data: {
      toolCalls: toolStatuses,
      references,
      clientActions,
      pendingConfirmation,
      stopReason,
      promptVersion: COPILOT_PROMPT_VERSION,
      model,
    },
  });

  emitMetric("CopilotTurn", 1, "Count", { stopReason });
  log.info("copilot turn", {
    conversationId: ctx.conversationId,
    userId: ctx.actor.id,
    model,
    promptVersion: COPILOT_PROMPT_VERSION,
    toolCalls: totalToolCalls,
    promptTokens,
    completionTokens,
    durationMs: Date.now() - startedAt,
    stopReason,
  });

  return {
    conversationId: ctx.conversationId,
    reply,
    messageId: stored.id,
    toolCalls: toolStatuses,
    references,
    clientActions,
    pendingConfirmation,
    model,
    promptVersion: COPILOT_PROMPT_VERSION,
    usage: promptTokens || completionTokens ? { promptTokens, completionTokens } : null,
    stopReason,
  };
}

function confirmationFallbackText(pending: PendingConfirmation) {
  const lines = [
    pending.preview.title,
    `Target: ${pending.preview.target}`,
    ...pending.preview.details.map((d) => `${d.label}: ${d.value}`),
  ];
  if (pending.preview.externalEffect) lines.push(pending.preview.externalEffect);
  lines.push("Confirm to proceed, or cancel.");
  return lines.join("\n");
}

function fallbackText(stopReason: CopilotTurn["stopReason"], statuses: CopilotToolStatus[]) {
  const failures = statuses.filter((s) => s.status === "error");
  if (failures.length) {
    return `I could not complete that. ${failures[0].message ?? "A lookup failed."}`;
  }
  if (stopReason === "timeout") {
    return "That request took too long and I stopped it. Nothing was changed — try a narrower question.";
  }
  if (stopReason === "tool_limit" || stopReason === "iteration_limit" || stopReason === "loop_guard") {
    return "I reached my limit for one question without settling on an answer. Ask about one case or one field at a time.";
  }
  return "I do not have an answer for that from the procurement records available to you.";
}
