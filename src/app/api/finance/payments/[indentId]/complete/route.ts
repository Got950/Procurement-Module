import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { indentIdParam } from "@/lib/schemas";
import { UnauthorizedError, ValidationError } from "@/lib/errors";
import { financeComplete } from "@/server/workflow/indent-workflow";

const bodySchema = z.object({
  proofDocumentId: z.string().min(1),
});

export const POST = withApiHandler({
  idempotent: true,
  params: indentIdParam,
  body: bodySchema,
})(async ({ session, params, body }) => {
  if (!session) throw new UnauthorizedError();
  if (!body.proofDocumentId) throw new ValidationError("proofDocumentId required");
  await financeComplete(params.indentId, session.sub, session.role, body.proofDocumentId);
  return NextResponse.json({ ok: true });
});
