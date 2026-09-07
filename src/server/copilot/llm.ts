import OpenAI from "openai";
import { AppError } from "@/lib/errors";

export type ChatToolCall = { id: string; name: string; argumentsJson: string };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ChatToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ChatToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatRequest = {
  messages: ChatMessage[];
  tools: ChatToolSpec[];
  maxOutputTokens: number;
  /** Set when no tool call is acceptable any more (final answer only). */
  disableTools?: boolean;
};

export type ChatResponse = {
  content: string | null;
  toolCalls: ChatToolCall[];
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
};

export type ChatFn = (request: ChatRequest) => Promise<ChatResponse>;

/** Raised when the model itself is unreachable, so the caller can say so. */
export class ModelUnavailableError extends AppError {
  constructor(message: string) {
    super("MODEL_UNAVAILABLE", message, 503);
  }
}

export function copilotModel() {
  return (
    process.env.OPENAI_COPILOT_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

function toOpenAiMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool" as const, tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === "assistant") {
      return {
        role: "assistant" as const,
        content: m.content ?? "",
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: c.argumentsJson },
              })),
            }
          : {}),
      };
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * The only place the Copilot talks to OpenAI. The key stays server-side, the
 * request is bounded by a timeout and an output cap, and retries are left to the
 * SDK's single attempt so a slow turn cannot fan out into repeated spend.
 */
export function openaiChat(): ChatFn {
  return async (request) => {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new ModelUnavailableError(
        "The assistant is not configured on this server (no model credentials)."
      );
    }
    const client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 1 });
    const model = copilotModel();
    try {
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.1,
        max_tokens: request.maxOutputTokens,
        messages: toOpenAiMessages(request.messages) as never,
        ...(request.disableTools || request.tools.length === 0
          ? {}
          : { tools: request.tools, tool_choice: "auto" as const }),
      });
      const choice = completion.choices[0]?.message;
      return {
        content: choice?.content ?? null,
        toolCalls: (choice?.tool_calls ?? [])
          .filter((c) => c.type === "function")
          .map((c) => ({
            id: c.id,
            name: c.function.name,
            argumentsJson: c.function.arguments ?? "{}",
          })),
        model,
        usage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ModelUnavailableError(`The assistant could not reach the language model: ${message}`);
    }
  };
}
