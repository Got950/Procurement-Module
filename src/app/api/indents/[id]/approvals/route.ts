import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { approvalBody, idParam } from "@/lib/schemas";
import { indentUseCases } from "@/server/application/indent-use-cases";
import { UnauthorizedError } from "@/lib/errors";

export const POST = withApiHandler({
  idempotent: true,
  params: idParam,
  body: approvalBody,
})(async ({ session, params, body }) => {
  if (!session) throw new UnauthorizedError();
  const actor = { id: session.sub, role: session.role };
  if (body.stage === "tl_indent") {
    await indentUseCases.tlIndent(actor, params.id, body.decision, body.remarks ?? "");
  } else if (body.stage === "tl_vendor") {
    await indentUseCases.tlVendor(actor, params.id, body.decision, body.remarks ?? "");
  } else if (body.stage === "md") {
    await indentUseCases.md(actor, params.id, body.decision, body.remarks ?? "");
  } else {
    await indentUseCases.director(actor, params.id, body.decision, body.remarks ?? "");
  }
  return NextResponse.json({ ok: true });
});
