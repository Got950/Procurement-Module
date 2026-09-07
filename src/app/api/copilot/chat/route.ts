import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { withConcurrencyGate } from "@/lib/concurrency";
import { UnauthorizedError } from "@/lib/errors";
import type { CopilotContext } from "@/server/copilot/context";
import {
  createConversation,
  loadOwnedConversation,
} from "@/server/copilot/conversation";
import { expirePendingConfirmations } from "@/server/copilot/confirmations";
import { runCopilotTurn } from "@/server/copilot/orchestrator";

const chatBody = z.object({
  conversationId: z.string().min(1).max(64).optional(),
  message: z.string().trim().min(1).max(2000),
});

export const POST = withApiHandler({
  body: chatBody,
  // Model calls cost money + CPU: per-IP cap plus global concurrency gate.
  rateLimit: { limit: 40, windowMs: 60_000 },
  auditSource: "COPILOT",
})(async ({ session, body, correlationId }) => {
  if (!session) throw new UnauthorizedError();
  return withConcurrencyGate(
    "copilot",
    "COPILOT_MAX_CONCURRENT",
    3,
    async () => {
      const actor = { id: session.sub, role: session.role, name: session.name };
      const conversation = body.conversationId
        ? await loadOwnedConversation(actor, body.conversationId)
        : await createConversation(actor, body.message);

      const ctx: CopilotContext = {
        actor,
        conversationId: conversation.id,
        correlationId,
      };
      await expirePendingConfirmations(ctx);
      const turn = await runCopilotTurn({ ctx, userMessage: body.message });
      return NextResponse.json(turn);
    },
    "Copilot is busy serving other users. Please retry in a few seconds."
  );
});
