import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { AuthorizationError, UnauthorizedError } from "@/lib/errors";
import { clearGmailCredentials } from "@/server/gmail-service";
import { appendAudit } from "@/server/audit-service";

export const POST = withApiHandler({ body: false })(async ({ session }) => {
  if (!session) throw new UnauthorizedError();
  if (session.role !== "ADMIN") throw new AuthorizationError();
  await clearGmailCredentials();
  await appendAudit({
    entityType: "GmailCredential",
    entityId: "mailbox",
    action: "GMAIL_DISCONNECTED",
    actorId: session.sub,
  });
  return NextResponse.json({ ok: true });
});
