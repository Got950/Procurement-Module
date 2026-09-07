import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { UnauthorizedError } from "@/lib/errors";
import type { CopilotContext } from "@/server/copilot/context";
import { loadOwnedConversation } from "@/server/copilot/conversation";
import { cancelCopilotAction, confirmCopilotAction } from "@/server/copilot/confirm";

const confirmBody = z.object({
  conversationId: z.string().min(1).max(64),
  confirmationId: z.string().min(1).max(64),
  decision: z.enum(["confirm", "cancel"]),
});

export const POST = withApiHandler({
  body: confirmBody,
  idempotent: true,
  rateLimit: { limit: 40, windowMs: 60_000 },
  auditSource: "COPILOT",
})(async ({ session, body, correlationId }) => {
  if (!session) throw new UnauthorizedError();
  const actor = { id: session.sub, role: session.role, name: session.name };
  const conversation = await loadOwnedConversation(actor, body.conversationId);
  const ctx: CopilotContext = {
    actor,
    conversationId: conversation.id,
    correlationId,
  };
  const result =
    body.decision === "confirm"
      ? await confirmCopilotAction({ ctx, confirmationId: body.confirmationId })
      : await cancelCopilotAction({ ctx, confirmationId: body.confirmationId });
  return NextResponse.json(result);
});
