import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { canProcurement } from "@/lib/rbac/policies";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { getGmailClient } from "@/server/gmail-service";
import { enqueueJob } from "@/server/jobs";
import { getCorrelationId } from "@/lib/logger";
import { runGmailSync } from "@/server/gmail-sync";

export const POST = withApiHandler({ body: false })(async ({ session }) => {
  if (!session || !canProcurement(session.role)) throw new AuthorizationError();
  const gmail = await getGmailClient();
  if (!gmail) throw new ValidationError("Gmail not connected");

  if (process.env.JOBS_INLINE === "1") {
    return NextResponse.json(await runGmailSync(session.sub));
  }

  const jobId = await enqueueJob({
    jobType: "gmail.sync",
    payload: { actorId: session.sub },
    idempotencyKey: `gmail.sync:${session.sub}:${Math.floor(Date.now() / 60_000)}`,
    correlationId: getCorrelationId(),
  });
  return NextResponse.json({ queued: true, jobId }, { status: 202 });
});
