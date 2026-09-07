import type { ChatResponse } from "@/server/copilot/llm";

/** Marker for scripted model-down responses in golden evals. */
export function unavailableTurn(): ChatResponse & { __unavailable: true } {
  return {
    content: null,
    toolCalls: [],
    model: "eval-fixture",
    __unavailable: true,
  };
}
