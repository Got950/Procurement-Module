import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { UnauthorizedError } from "@/lib/errors";
import { loadMessages, loadOwnedConversation } from "@/server/copilot/conversation";

export const GET = withApiHandler({
  params: idParam,
  body: false,
  auditSource: "COPILOT",
})(async ({ session, params }) => {
  if (!session) throw new UnauthorizedError();
  const actor = { id: session.sub, role: session.role, name: session.name };
  const conversation = await loadOwnedConversation(actor, params.id);
  const messages = await loadMessages(conversation.id);
  return NextResponse.json({
    conversationId: conversation.id,
    title: conversation.title,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      data: m.data,
      createdAt: m.createdAt,
    })),
  });
});
