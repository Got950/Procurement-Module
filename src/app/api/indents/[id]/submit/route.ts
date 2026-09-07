import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { indentUseCases } from "@/server/application/indent-use-cases";
import { UnauthorizedError } from "@/lib/errors";

export const POST = withApiHandler({
  idempotent: true,
  params: idParam,
  body: false,
})(async ({ session, params }) => {
  if (!session) throw new UnauthorizedError();
  await indentUseCases.submit({ id: session.sub, role: session.role }, params.id);
  return NextResponse.json({ ok: true });
});
