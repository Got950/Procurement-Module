import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { indentIdParam } from "@/lib/schemas";
import { AuthorizationError, UnauthorizedError } from "@/lib/errors";
import { canProcurement } from "@/lib/rbac/policies";
import { sendPurchaseOrderEmail } from "@/server/po-delivery";

const sendPoBody = z.object({
  poId: z.string().min(1),
});

export const POST = withApiHandler({
  idempotent: true,
  params: indentIdParam,
  body: sendPoBody,
})(async ({ session, params, body }) => {
  if (!session) throw new UnauthorizedError();
  if (!canProcurement(session.role)) throw new AuthorizationError();
  const result = await sendPurchaseOrderEmail(
    params.indentId,
    { id: session.sub, role: session.role },
    body.poId
  );
  return NextResponse.json({ ok: true, emailed: true, gmailMessageId: result.gmailMessageId });
});
