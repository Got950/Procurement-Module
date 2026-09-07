import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { UnauthorizedError } from "@/lib/errors";
import { listConversations } from "@/server/copilot/conversation";

export const GET = withApiHandler({ body: false, auditSource: "COPILOT" })(async ({ session }) => {
  if (!session) throw new UnauthorizedError();
  const rows = await listConversations({
    id: session.sub,
    role: session.role,
    name: session.name,
  });
  return NextResponse.json({
    conversations: rows.map((c) => ({
      id: c.id,
      title: c.title,
      messageCount: c.message_count,
      lastActiveAt: c.last_active_at,
    })),
  });
});
