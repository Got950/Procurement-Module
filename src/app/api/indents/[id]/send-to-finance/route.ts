import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { UnauthorizedError } from "@/lib/errors";
import { sendIndentToFinance } from "@/server/workflow/indent-workflow";

export const POST = withApiHandler({
  params: idParam,
  body: false,
})(async ({ session, params }) => {
  if (!session) throw new UnauthorizedError();
  await sendIndentToFinance(params.id, session.sub, session.role);
  return NextResponse.json({ ok: true });
});
