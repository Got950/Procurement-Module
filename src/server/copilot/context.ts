import type { Role } from "@/lib/domain-types";

/**
 * The authenticated caller, resolved server-side from the session. Nothing the
 * model emits can change these fields: tools read authorization from here only.
 */
export type CopilotActor = {
  id: string;
  role: Role;
  name: string;
};

export type CopilotContext = {
  actor: CopilotActor;
  conversationId: string;
  correlationId: string;
  /**
   * Set only while executing a consequential tool under an explicit, unexpired
   * user confirmation. Absent during a normal chat turn, which is what forces
   * write tools to stop and ask instead of acting.
   */
  confirmationId?: string;
};

export type ConfirmationPreview = {
  title: string;
  target: string;
  details: { label: string; value: string }[];
  /** Human-readable warning when the action leaves the system (e-mail, money). */
  externalEffect: string | null;
};

export type ResourceRef = {
  type: "indent" | "vendor" | "item" | "document" | "route";
  id: string;
  label: string;
  href?: string;
};

/**
 * Side effects the browser must perform after a successful tool result.
 * URLs are always same-origin application routes that re-check auth on fetch.
 */
export type CopilotClientAction =
  | { type: "download"; url: string; filename: string }
  | { type: "navigate"; href: string };
