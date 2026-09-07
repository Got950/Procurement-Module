/* eslint-disable @typescript-eslint/no-explicit-any */
import type { z } from "zod";
import type { Role } from "@/lib/domain-types";
import type { ConfirmationPreview, CopilotContext, ResourceRef } from "@/server/copilot/context";

export type ToolKind = "read" | "write";

export type CopilotTool<I = any> = {
  /** Unique registered name. Anything not in the registry fails closed. */
  name: string;
  description: string;
  kind: ToolKind;
  /** Consequential actions cannot run inside a chat turn without a confirmation. */
  requiresConfirmation: boolean;
  /** Coarse gate; resource-level authorization still happens inside `execute`. */
  allowedRoles: readonly Role[];
  timeoutMs: number;
  /** JSON Schema advertised to the model. Additional properties are rejected. */
  parameters: Record<string, unknown>;
  /** Server-side validator. The JSON Schema is a hint; this is the gate. */
  input: z.ZodType<I>;
  target?: (input: I) => { type: string; id: string } | null;
  references?: (result: any) => ResourceRef[];
  preview?: (input: I, ctx: CopilotContext) => Promise<ConfirmationPreview>;
  execute: (input: I, ctx: CopilotContext) => Promise<unknown>;
};

export function defineTool<I>(tool: CopilotTool<I>): CopilotTool<I> {
  if (tool.kind === "write" && tool.requiresConfirmation && !tool.preview) {
    throw new Error(`Tool ${tool.name} requires confirmation but defines no preview`);
  }
  return tool;
}

export function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

const registry = new Map<string, CopilotTool>();

export function registerTools(tools: CopilotTool<any>[]) {
  for (const tool of tools) {
    if (registry.has(tool.name)) throw new Error(`Duplicate copilot tool ${tool.name}`);
    registry.set(tool.name, tool);
  }
}

/** Unknown names return undefined; callers must treat that as a hard failure. */
export function getTool(name: string): CopilotTool | undefined {
  return registry.get(name);
}

export function allTools(): CopilotTool[] {
  return [...registry.values()];
}

/** The model is only shown the tools this role may use. */
export function toolsForRole(role: Role): CopilotTool[] {
  return allTools().filter((t) => t.allowedRoles.includes(role));
}

export function toolSpecsForRole(role: Role) {
  return toolsForRole(role).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
