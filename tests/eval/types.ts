import type { ChatResponse } from "@/server/copilot/llm";
import type { Role } from "@/lib/domain-types";

/** Dimensions from docs/architecture/EVALUATION.md */
export type EvalDimension =
  | "tool_selection"
  | "tool_execution"
  | "groundedness"
  | "safety"
  | "hitl"
  | "authz"
  | "trajectory"
  | "reliability";

export type EvalActorRole = Extract<
  Role,
  "REQUESTER" | "PROCUREMENT" | "FINANCE" | "TEAM_LEADER" | "DIRECTOR" | "MD" | "ADMIN"
>;

export type ScriptedModelTurn = ChatResponse;

export type EvalExpectation = {
  /** Exact stopReason when set. */
  stopReason?: "completed" | "iteration_limit" | "tool_limit" | "loop_guard" | "timeout";
  /** Reply must match (case-insensitive). */
  replyMatches?: RegExp;
  /** Reply must NOT match. */
  replyMustNotMatch?: RegExp;
  /** Tool statuses observed on the turn. */
  toolStatuses?: Array<{ name: string; status: "ok" | "error" | "confirmation" }>;
  /** Indent status after the case (by setup key). */
  indentStatus?: { key: string; status: string };
  /** Whether a pending confirmation must be present. */
  pendingConfirmation?: boolean;
  /** promptVersion must equal current constant when true. */
  promptVersionPresent?: boolean;
  /** Max model chat invocations for this case. */
  maxModelCalls?: number;
};

/**
 * A golden case. Model behaviour is fully scripted via ChatFn — CI never spends tokens.
 * Cases that need Postgres use `needsDb: true` and run under describeDb.
 */
export type EvalCase = {
  id: string;
  title: string;
  dimensions: EvalDimension[];
  /** Fast canary subset — run before full suite / prompt changes. */
  canary?: boolean;
  needsDb: boolean;
  /** Actor role for the conversation (DB cases). */
  actorRole?: EvalActorRole;
  /** User message for orchestrator cases. */
  userMessage?: string;
  /** Scripted model responses in order. */
  modelScript?: ScriptedModelTurn[];
  /**
   * Setup hook name resolved by the runner.
   * Built-in: empty, two_requester_indents, draft_indent, none
   */
  setup?:
    | "none"
    | "own_indent"
    | "two_requester_indents"
    | "draft_for_submit"
    | "own_indent_malicious_doc";
  /**
   * Kind of evaluation path.
   * - turn: runCopilotTurn with scripted chat
   * - tool: single executeToolCall (authz / hitl without model)
   * - pure: no DB — fencing / registry / limits
   */
  kind: "turn" | "tool" | "pure";
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    targetIndent?: "own" | "other";
    /** Resolve $document to the malicious/test document id from setup. */
    targetDocument?: "own";
  };
  /** After a confirmation-producing tool call, run confirmCopilotAction once. */
  confirmAfter?: boolean;
  expect: EvalExpectation;
  /** Extra pure assertions identified by name. */
  pureCheck?: "untrusted_fence" | "no_sql_tool" | "requester_cannot_send_rfq" | "limits_bounded";
};
