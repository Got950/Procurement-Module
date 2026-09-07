/* eslint-disable @typescript-eslint/no-explicit-any */
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { appendAudit } from "@/server/audit-service";
import type { ConfirmationPreview, CopilotContext, ResourceRef } from "@/server/copilot/context";
import { getTool, type CopilotTool } from "@/server/copilot/tool-registry";
import { createConfirmation, hashArgs } from "@/server/copilot/confirmations";
import { recordToolExecution } from "@/server/copilot/conversation";

export type ToolOutcome =
  | { kind: "ok"; toolName: string; result: any; references: ResourceRef[]; durationMs: number }
  | {
      kind: "confirmation";
      toolName: string;
      confirmationId: string;
      preview: ConfirmationPreview;
    }
  | { kind: "error"; toolName: string; code: string; message: string; details?: unknown };

class ToolTimeoutError extends AppError {
  constructor(toolName: string, ms: number) {
    super("TOOL_TIMEOUT", `The ${toolName} lookup took longer than ${ms}ms and was stopped.`, 504);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ToolTimeoutError(toolName, ms)), ms);
    }),
  ]).finally(() => clearTimeout(timer!)) as Promise<T>;
}

function parseArguments(tool: CopilotTool, rawArgs: string | Record<string, unknown>) {
  let parsed: unknown;
  if (typeof rawArgs === "string") {
    try {
      parsed = rawArgs.trim() ? JSON.parse(rawArgs) : {};
    } catch {
      throw new AppError("INVALID_ARGUMENTS", "Tool arguments were not valid JSON.", 400);
    }
  } else {
    parsed = rawArgs ?? {};
  }
  try {
    return tool.input.parse(parsed);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError(
        "INVALID_ARGUMENTS",
        "Tool arguments failed validation.",
        400,
        error.flatten()
      );
    }
    throw error;
  }
}

function toOutcomeError(toolName: string, error: unknown): ToolOutcome {
  if (error instanceof AppError) {
    return { kind: "error", toolName, code: error.code, message: error.message, details: error.details };
  }
  // Unexpected failures are logged server-side and reported generically: the
  // model must not receive internal messages, and it must not see success.
  log.error("copilot tool failed", {
    tool: toolName,
    error: error instanceof Error ? error.message : String(error),
  });
  return {
    kind: "error",
    toolName,
    code: "INTERNAL",
    message: "The tool failed for an internal reason and no change was made.",
  };
}

/**
 * Runs one tool call end to end: registry lookup, role gate, schema validation,
 * confirmation gate, bounded execution, audit and observability. Every path
 * through here either produces a real backend result or an explicit failure —
 * never an assumed success.
 */
export async function executeToolCall(params: {
  ctx: CopilotContext;
  toolName: string;
  rawArgs: string | Record<string, unknown>;
}): Promise<ToolOutcome> {
  const { ctx, toolName } = params;
  const started = Date.now();
  const tool = getTool(toolName);

  if (!tool) {
    await recordToolExecution({
      conversationId: ctx.conversationId,
      userId: ctx.actor.id,
      toolName: toolName.slice(0, 100),
      toolKind: "unknown",
      status: "REJECTED",
      errorCode: "UNKNOWN_TOOL",
      correlationId: ctx.correlationId,
    });
    return {
      kind: "error",
      toolName,
      code: "UNKNOWN_TOOL",
      message: `There is no tool called ${toolName}. Use only the tools provided.`,
    };
  }

  if (!tool.allowedRoles.includes(ctx.actor.role)) {
    await recordToolExecution({
      conversationId: ctx.conversationId,
      userId: ctx.actor.id,
      toolName: tool.name,
      toolKind: tool.kind,
      status: "REJECTED",
      errorCode: "FORBIDDEN",
      correlationId: ctx.correlationId,
    });
    const permissionMessage =
      tool.name === "record_approval_decision"
        ? "You don't have permission to approve or reject this indent."
        : `You don't have permission to perform this action (${tool.name}).`;
    return {
      kind: "error",
      toolName,
      code: "FORBIDDEN",
      message: permissionMessage,
    };
  }

  let input: any;
  try {
    input = parseArguments(tool, params.rawArgs);
  } catch (error) {
    await recordToolExecution({
      conversationId: ctx.conversationId,
      userId: ctx.actor.id,
      toolName: tool.name,
      toolKind: tool.kind,
      status: "REJECTED",
      errorCode: "INVALID_ARGUMENTS",
      correlationId: ctx.correlationId,
    });
    return toOutcomeError(tool.name, error);
  }

  const target = tool.target?.(input) ?? null;
  const argsHash = hashArgs(tool.name, input);

  if (tool.kind === "write" && tool.requiresConfirmation && !ctx.confirmationId) {
    try {
      const preview = await withTimeout(tool.preview!(input, ctx), tool.timeoutMs, tool.name);
      const confirmation = await createConfirmation({
        ctx,
        toolName: tool.name,
        args: input,
        target,
        preview,
      });
      await recordToolExecution({
        conversationId: ctx.conversationId,
        userId: ctx.actor.id,
        toolName: tool.name,
        toolKind: tool.kind,
        status: "CONFIRMATION_REQUIRED",
        targetType: target?.type ?? null,
        targetId: target?.id ?? null,
        argsHash,
        durationMs: Date.now() - started,
        correlationId: ctx.correlationId,
      });
      return {
        kind: "confirmation",
        toolName: tool.name,
        confirmationId: confirmation.id,
        preview,
      };
    } catch (error) {
      const outcome = toOutcomeError(tool.name, error);
      await recordToolExecution({
        conversationId: ctx.conversationId,
        userId: ctx.actor.id,
        toolName: tool.name,
        toolKind: tool.kind,
        status: "FAILED",
        targetType: target?.type ?? null,
        targetId: target?.id ?? null,
        argsHash,
        durationMs: Date.now() - started,
        errorCode: outcome.kind === "error" ? outcome.code : null,
        errorMessage: outcome.kind === "error" ? outcome.message : null,
        correlationId: ctx.correlationId,
      });
      return outcome;
    }
  }

  try {
    const result = await withTimeout(tool.execute(input, ctx), tool.timeoutMs, tool.name);
    const durationMs = Date.now() - started;
    await recordToolExecution({
      conversationId: ctx.conversationId,
      userId: ctx.actor.id,
      toolName: tool.name,
      toolKind: tool.kind,
      status: "SUCCEEDED",
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      argsHash,
      durationMs,
      correlationId: ctx.correlationId,
    });
    if (tool.kind === "write") {
      await appendAudit({
        entityType: "CopilotAction",
        entityId: ctx.confirmationId ?? ctx.conversationId,
        action: `COPILOT_${tool.name.toUpperCase()}`,
        actorId: ctx.actor.id,
        indentId: (result as any)?.indentId ?? null,
        source: "COPILOT",
        diff: {
          conversationId: ctx.conversationId,
          confirmationId: ctx.confirmationId ?? null,
          status: (result as any)?.status ?? "SUCCEEDED",
        },
      });
    }
    log.info("copilot tool executed", {
      tool: tool.name,
      kind: tool.kind,
      conversationId: ctx.conversationId,
      userId: ctx.actor.id,
      durationMs,
    });
    return {
      kind: "ok",
      toolName: tool.name,
      result,
      references: tool.references?.(result) ?? [],
      durationMs,
    };
  } catch (error) {
    const outcome = toOutcomeError(tool.name, error);
    await recordToolExecution({
      conversationId: ctx.conversationId,
      userId: ctx.actor.id,
      toolName: tool.name,
      toolKind: tool.kind,
      status: error instanceof AppError && error.code === "TOOL_TIMEOUT" ? "TIMEOUT" : "FAILED",
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      argsHash,
      durationMs: Date.now() - started,
      errorCode: outcome.kind === "error" ? outcome.code : null,
      errorMessage: outcome.kind === "error" ? outcome.message : null,
      correlationId: ctx.correlationId,
    });
    if (tool.kind === "write") {
      await appendAudit({
        entityType: "CopilotAction",
        entityId: ctx.confirmationId ?? ctx.conversationId,
        action: `COPILOT_${tool.name.toUpperCase()}_FAILED`,
        actorId: ctx.actor.id,
        indentId: null,
        source: "COPILOT",
        diff: {
          conversationId: ctx.conversationId,
          confirmationId: ctx.confirmationId ?? null,
          errorCode: outcome.kind === "error" ? outcome.code : "INTERNAL",
        },
      });
    }
    return outcome;
  }
}
